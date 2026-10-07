"""
MCP (Model Context Protocol) surface for the Perfox "Dashboard Insights" agent.

A single JSON-RPC endpoint, `POST /mcp`, implementing the three methods a
Perfox Integration node needs: `initialize`, `tools/list`, `tools/call`. Each
tool is a thin wrapper around the read functions already built for the
`/agent/*` surface (app/main.py) and the CRM agent surface (app/crm_api.py) -
no new queries, just JSON-RPC dispatch onto what already exists.

The `/agent/*` functions live in app.main, which imports this module's router
(app.main:93-97-style `include_router`), so importing them back at module
load time would be circular - they're imported lazily inside each handler
instead.
"""

from __future__ import annotations

import os
import secrets
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel

from .crm_api import (
    FetchBookingsPayload,
    FetchLeadsPayload,
    fetch_bookings_for_agent,
    fetch_leads_for_agent,
)


def require_mcp_token(
    authorization: Optional[str] = Header(None),
) -> None:
    """
    Bearer-only guard for the /mcp surface, mirroring require_agent_key
    (app/crm_api.py). Perfox's "Register MCP server" screen wants a single
    bearer credential, so this doesn't also accept X-API-Key.

    Unset PERFOX_MCP_TOKEN leaves the route open, same convention as
    AGENT_API_KEY - fine for local dev, not for the deployed URL Perfox
    actually calls.
    """
    expected = os.environ.get("PERFOX_MCP_TOKEN", "").strip()
    if not expected:
        return

    sent = ""
    if authorization:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() == "bearer":
            sent = token.strip()

    if not sent or not secrets.compare_digest(sent, expected):
        raise HTTPException(status_code=401, detail="Invalid or missing MCP token.")


router = APIRouter(prefix="/mcp", tags=["mcp"], dependencies=[Depends(require_mcp_token)])


class JsonRpcRequest(BaseModel):
    jsonrpc: str = "2.0"
    id: Optional[int | str] = None
    method: str
    params: Optional[dict] = None


# ---------------------------------------------------------------------------
# Tool implementations - each takes the JSON-RPC `arguments` dict and returns
# a plain JSON-able value. Business logic stays in app.main / app.crm_api;
# these just adapt call shape.
# ---------------------------------------------------------------------------

def _dashboard_month_note(result: Any) -> Any:
    """The snapshot and the scorecard count the month the dashboard is set to,
    which anyone can change from its month selector. Say which month that is,
    and when it is not the calendar month, say so."""
    from .agent_insights import resolve_month
    m = resolve_month("active")
    about = {"month": m["month"], "calendar_month": m["calendar_month"]}
    if m["month"] != m["calendar_month"]:
        about["note"] = (f"These figures are for {m['month']}, the month the dashboard is set to - "
                         f"not the calendar month ({m['calendar_month']}). For another month use "
                         f"get_bookings_summary, get_leads_summary or get_consultant_leaderboard with month.")
    return {**about, "figures": result}


def _tool_get_dealership_snapshot(args: dict) -> Any:
    from .main import agent_snapshot
    return _dashboard_month_note(agent_snapshot())


def _tool_get_consultant_scorecard(args: dict) -> Any:
    from .main import agent_consultant
    name = args.get("name")
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    return _dashboard_month_note(agent_consultant(name=name))


def _period_arg(args: dict) -> str:
    """get_leads / get_bookings take a month as 'active', 'all', or anything
    resolve_month reads ('current', 'last', 'September', 'SEP2026')."""
    want = (args.get("period") or args.get("month") or "active").strip()
    if want.lower() in ("active", "all"):
        return want
    from .agent_insights import resolve_month
    return resolve_month(want)["month"]


def _tool_get_action_list(args: dict) -> Any:
    from .main import agent_action_list
    return agent_action_list()


def _tool_get_vehicle_availability(args: dict) -> Any:
    from .main import agent_availability
    return agent_availability(
        model=args.get("model"),
        variant=args.get("variant"),
        colour=args.get("colour"),
    )


def _tool_get_order_status(args: dict) -> Any:
    from .main import agent_order_status
    name = args.get("name")
    mobile = args.get("mobile")
    if not name and not mobile:
        raise HTTPException(status_code=400, detail="pass either name or mobile")
    return agent_order_status(name=name, mobile=mobile)


def _tool_get_model_catalogue(args: dict) -> Any:
    from .main import agent_model_catalogue
    return agent_model_catalogue()


def _tool_get_leads(args: dict) -> Any:
    payload = FetchLeadsPayload(
        limit=args.get("limit", 50),
        status=args.get("status", "New"),
        period=_period_arg(args),
        search=args.get("search"),
        date_from=args.get("date_from") or args.get("date"),
        date_to=args.get("date_to") or args.get("date"),
    )
    return fetch_leads_for_agent(payload)


def _tool_get_bookings(args: dict) -> Any:
    payload = FetchBookingsPayload(
        limit=args.get("limit", 50),
        period=_period_arg(args),
        search=args.get("search"),
        status=args.get("status"),
        date_from=args.get("date_from") or args.get("date"),
        date_to=args.get("date_to") or args.get("date"),
    )
    return fetch_bookings_for_agent(payload)


def _yes(value: Any, default: bool = True) -> bool:
    """A flag as an agent may send it: true/false, or 'true'/'no'/'0'."""
    if value is None:
        return default
    return str(value).strip().lower() not in ("false", "no", "0", "off")


def _tool_get_test_drives(args: dict) -> Any:
    from .test_drives import agent_test_drives
    return agent_test_drives(
        date_=args.get("date"),
        date_from=args.get("date_from"),
        date_to=args.get("date_to"),
        status=args.get("status"),
        car=args.get("car"),
        search=args.get("search"),
        include_samples=_yes(args.get("include_samples")),
        limit=int(args.get("limit") or 60),
    )


def _tool_get_bookings_summary(args: dict) -> Any:
    from .agent_insights import bookings_summary
    return bookings_summary(month=args.get("month"),
                            date_from=args.get("date_from") or args.get("date"),
                            date_to=args.get("date_to") or args.get("date"))


def _tool_get_leads_summary(args: dict) -> Any:
    from .agent_insights import leads_summary
    return leads_summary(month=args.get("month"),
                         date_from=args.get("date_from") or args.get("date"),
                         date_to=args.get("date_to") or args.get("date"))


def _tool_get_consultant_leaderboard(args: dict) -> Any:
    from .agent_insights import consultant_leaderboard
    return consultant_leaderboard(month=args.get("month"), top=int(args.get("top") or 10))


def _tool_get_test_drive_enquiries(args: dict) -> Any:
    from .test_drives import agent_test_drive_enquiries
    return agent_test_drive_enquiries(
        car=args.get("car"),
        include_samples=_yes(args.get("include_samples")),
        limit=int(args.get("limit") or 60),
    )


TOOLS: list[dict] = [
    {
        "name": "get_dealership_snapshot",
        "description": "Headline figures (enquiries, bookings, retails, targets, stock) for the month the dashboard is currently set to - which anyone can change, so it is not always the calendar month; the reply says which month. For this month, another month or a day, use get_bookings_summary, get_leads_summary, get_consultant_leaderboard or get_test_drives instead.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_consultant_scorecard",
        "description": "One sales consultant's full scorecard against target (enquiries, test drives, bookings, retails, finance, insurance) for the month the dashboard is set to; the reply says which month. To rank consultants, use get_consultant_leaderboard.",
        "input_schema": {
            "type": "object",
            "properties": {"name": {"type": "string", "description": "Consultant name, full or partial"}},
            "required": ["name"],
        },
    },
    {
        "name": "get_action_list",
        "description": "What needs chasing today: stock past its retail deadline, stock aging over 90 days, backorders, and bookings missing a CRM entry.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_vehicle_availability",
        "description": "Is a specific car in stock right now? Filter by model, variant/trim, and/or colour.",
        "input_schema": {
            "type": "object",
            "properties": {
                "model": {"type": "string", "description": "Model or family, e.g. Virtus, Taigun"},
                "variant": {"type": "string", "description": "Trim, e.g. GT Line AT"},
                "colour": {"type": "string", "description": "Colour name, e.g. Candy White"},
            },
        },
    },
    {
        "name": "get_order_status",
        "description": "A customer's booking/order status - pass their name and/or mobile number.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Customer name, full or partial"},
                "mobile": {"type": "string", "description": "10-digit mobile number"},
            },
        },
    },
    {
        "name": "get_model_catalogue",
        "description": "Every model and trim the dealership actually transacts, with live free stock counts.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_leads",
        "description": "Enquiries/leads, live from the database. For a day or days (today, yesterday, a date) pass date or date_from/date_to: that reads those days whatever reporting month the dashboard is set to. Otherwise reads the active (or a named) reporting month. Optionally filter by status or search name/mobile.",
        "input_schema": {
            "type": "object",
            "properties": {
                "date": {"type": "string", "description": "One day: 'today', 'yesterday' or YYYY-MM-DD (India time)"},
                "date_from": {"type": "string", "description": "First day of a span, as for date"},
                "date_to": {"type": "string", "description": "Last day of a span, as for date"},
                "limit": {"type": "integer", "description": "Max rows, default 50"},
                "status": {"type": "string", "description": "Lead status, default 'New'; 'all' for every status"},
                "period": {"type": "string", "description": "Month: 'current' (this calendar month), 'last', a month name or label like 'September' / 'SEP2026', 'active' (the month the dashboard is set to; the default), or 'all'. Ignored when a date is given"},
                "search": {"type": "string", "description": "Matches lead name or mobile"},
            },
        },
    },
    {
        "name": "get_bookings",
        "description": "Orders/bookings, live from the database. For a day or days pass date or date_from/date_to (on the booking date), whatever reporting month the dashboard is set to. Otherwise reads the active (or a named) reporting month. Optionally filter by fulfilment status or search customer name/mobile.",
        "input_schema": {
            "type": "object",
            "properties": {
                "date": {"type": "string", "description": "One day: 'today', 'yesterday' or YYYY-MM-DD (India time)"},
                "date_from": {"type": "string", "description": "First day of a span, as for date"},
                "date_to": {"type": "string", "description": "Last day of a span, as for date"},
                "limit": {"type": "integer", "description": "Max rows, default 50"},
                "period": {"type": "string", "description": "Month: 'current' (this calendar month), 'last', a month name or label like 'September' / 'SEP2026', 'active' (the month the dashboard is set to; the default), or 'all'. Ignored when a date is given"},
                "search": {"type": "string", "description": "Matches customer name or mobile"},
                "status": {"type": "string", "description": "fulfilment_status: BOOKED / NO_STOCK / ALLOTED / RETAILED / CANCELLED"},
            },
        },
    },
    {
        "name": "get_bookings_summary",
        "description": "Booking COUNTS for a month (default: this calendar month) or a span of days: the total, by model (as the dashboard's Inventory page counts them, e.g. TAIGUN includes Taigun FL), by consultant and by fulfilment status. Use this for any 'how many bookings' question - never count rows yourself.",
        "input_schema": {
            "type": "object",
            "properties": {
                "month": {"type": "string", "description": "'current' (default, this calendar month), 'last', a month name or label like 'September' / 'SEP2026', or 'active' (the month the dashboard is set to)"},
                "date": {"type": "string", "description": "One day instead of a month: 'today', 'yesterday' or YYYY-MM-DD"},
                "date_from": {"type": "string", "description": "First day of a span"},
                "date_to": {"type": "string", "description": "Last day of a span"},
            },
        },
    },
    {
        "name": "get_leads_summary",
        "description": "Enquiry/lead COUNTS for a month (default: this calendar month) or a span of days: the total, how many qualified, by source channel (CRM, WALKIN, TELE, DIGITAL, REFERRAL...), by model and by consultant. Use this for any 'how many leads/enquiries' question - never count rows yourself.",
        "input_schema": {
            "type": "object",
            "properties": {
                "month": {"type": "string", "description": "'current' (default, this calendar month), 'last', a month name or label like 'September' / 'SEP2026', or 'active' (the month the dashboard is set to)"},
                "date": {"type": "string", "description": "One day instead of a month: 'today', 'yesterday' or YYYY-MM-DD"},
                "date_from": {"type": "string", "description": "First day of a span"},
                "date_to": {"type": "string", "description": "Last day of a span"},
            },
        },
    },
    {
        "name": "get_consultant_leaderboard",
        "description": "Sales consultants ranked as the dashboard's People page ranks them (by bookings, then retails) for a month (default: this calendar month), with bookings, booking target, % of target and enquiries. Use for 'top consultants', 'who is leading', 'rank the team'.",
        "input_schema": {
            "type": "object",
            "properties": {
                "month": {"type": "string", "description": "'current' (default, this calendar month), 'last', a month name or label like 'September' / 'SEP2026', or 'active' (the month the dashboard is set to)"},
                "top": {"type": "integer", "description": "How many to list, default 10"},
            },
        },
    },
    {
        "name": "get_test_drives",
        "description": "Test drives from the dashboard's Test Drives section, live from the database: booked, attended, no-show and cancelled drives with day, time, car, customer, executive and place, plus test-drive enquiries. For one day (default today) or a span of up to 62 days. Also returns the section's headline figures. Drives marked sample=true are made-up demo drives.",
        "input_schema": {
            "type": "object",
            "properties": {
                "date": {"type": "string", "description": "One day: 'today' (default), 'tomorrow', 'yesterday' or YYYY-MM-DD"},
                "date_from": {"type": "string", "description": "First day of a span, as for date"},
                "date_to": {"type": "string", "description": "Last day of a span, as for date"},
                "status": {"type": "string", "description": "booked, attended, no_show, cancelled or enquiry; omit for all"},
                "car": {"type": "string", "description": "Taigun, Virtus, Tayron, Tiguan R-Line or Golf GTI"},
                "search": {"type": "string", "description": "Customer name, or 4+ digits of their phone"},
                "include_samples": {"type": "boolean", "description": "Include the made-up sample drives (default true)"},
                "limit": {"type": "integer", "description": "Max drives listed, default 60"},
            },
        },
    },
    {
        "name": "get_test_drive_enquiries",
        "description": "Test-drive enquiries waiting for a time, live from the database: customers who asked for a test drive with no slot booked yet, with the day and time they asked for and the day the enquiry came in.",
        "input_schema": {
            "type": "object",
            "properties": {
                "car": {"type": "string", "description": "Taigun, Virtus, Tayron, Tiguan R-Line or Golf GTI"},
                "include_samples": {"type": "boolean", "description": "Include the made-up sample enquiries (default true)"},
                "limit": {"type": "integer", "description": "Max enquiries listed, default 60"},
            },
        },
    },
]

TOOL_HANDLERS: dict[str, Callable[[dict], Any]] = {
    "get_dealership_snapshot": _tool_get_dealership_snapshot,
    "get_consultant_scorecard": _tool_get_consultant_scorecard,
    "get_action_list": _tool_get_action_list,
    "get_vehicle_availability": _tool_get_vehicle_availability,
    "get_order_status": _tool_get_order_status,
    "get_model_catalogue": _tool_get_model_catalogue,
    "get_leads": _tool_get_leads,
    "get_bookings": _tool_get_bookings,
    "get_bookings_summary": _tool_get_bookings_summary,
    "get_leads_summary": _tool_get_leads_summary,
    "get_consultant_leaderboard": _tool_get_consultant_leaderboard,
    "get_test_drives": _tool_get_test_drives,
    "get_test_drive_enquiries": _tool_get_test_drive_enquiries,
}


# ---------------------------------------------------------------------------
# JSON-RPC dispatch
# ---------------------------------------------------------------------------

def _rpc_result(id_: Any, result: Any) -> dict:
    return {"jsonrpc": "2.0", "id": id_, "result": result}


def _rpc_error(id_: Any, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": id_, "error": {"code": code, "message": message}}


@router.post("", response_model=None)
def mcp_rpc(body: JsonRpcRequest) -> dict | Response:
    # A notification - notifications/initialized, sent once the handshake is
    # done - wants no answer: Streamable HTTP expects 202 and an empty body,
    # where an error reply can make a client drop the connection.
    if body.method.startswith("notifications/"):
        return Response(status_code=202)

    if body.method == "ping":
        return _rpc_result(body.id, {})

    if body.method == "initialize":
        return _rpc_result(body.id, {
            "protocolVersion": "2024-11-05",
            "serverInfo": {"name": "elite-dashboard-mcp", "version": "1.0.0"},
            "capabilities": {"tools": {}},
        })

    if body.method == "tools/list":
        # The MCP spec names a tool's parameters inputSchema; this server has
        # always sent input_schema. Both, so a client reading either - Perfox,
        # an MCP proxy - sees what each tool takes.
        return _rpc_result(body.id, {"tools": [{**t, "inputSchema": t["input_schema"]} for t in TOOLS]})

    if body.method == "tools/call":
        params = body.params or {}
        name = params.get("name")
        arguments = params.get("arguments") or {}
        handler = TOOL_HANDLERS.get(name)
        if handler is None:
            return _rpc_error(body.id, -32601, f"Unknown tool: {name}")
        try:
            result = handler(arguments)
        except HTTPException as exc:
            return _rpc_result(body.id, {
                "content": [{"type": "text", "text": str(exc.detail)}],
                "isError": True,
            })
        except Exception as exc:  # noqa: BLE001 - surfaced to the agent, not swallowed
            return _rpc_result(body.id, {
                "content": [{"type": "text", "text": str(exc)}],
                "isError": True,
            })
        return _rpc_result(body.id, {
            "content": [{"type": "json", "json": result}],
            "isError": False,
        })

    return _rpc_error(body.id, -32601, f"Unknown method: {body.method}")
