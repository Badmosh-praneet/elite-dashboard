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

from fastapi import APIRouter, Depends, Header, HTTPException
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

def _tool_get_dealership_snapshot(args: dict) -> Any:
    from .main import agent_snapshot
    return agent_snapshot()


def _tool_get_consultant_scorecard(args: dict) -> Any:
    from .main import agent_consultant
    name = args.get("name")
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    return agent_consultant(name=name)


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
        period=args.get("period", "active"),
        search=args.get("search"),
    )
    return fetch_leads_for_agent(payload)


def _tool_get_bookings(args: dict) -> Any:
    payload = FetchBookingsPayload(
        limit=args.get("limit", 50),
        period=args.get("period", "active"),
        search=args.get("search"),
        status=args.get("status"),
    )
    return fetch_bookings_for_agent(payload)


TOOLS: list[dict] = [
    {
        "name": "get_dealership_snapshot",
        "description": "One-call summary of how the dealership is doing this reporting month: leads, bookings, retails, targets.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_consultant_scorecard",
        "description": "A single sales consultant's scorecard against target this month.",
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
        "description": "Enquiries/leads for the active (or a named) reporting month. Optionally filter by status or search name/mobile.",
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "description": "Max rows, default 50"},
                "status": {"type": "string", "description": "Lead status, default 'New'"},
                "period": {"type": "string", "description": "'active' (default), a month label like 'AUG2026', or 'all'"},
                "search": {"type": "string", "description": "Matches lead name or mobile"},
            },
        },
    },
    {
        "name": "get_bookings",
        "description": "Orders/bookings for the active (or a named) reporting month. Optionally filter by fulfilment status or search customer name/mobile.",
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "description": "Max rows, default 50"},
                "period": {"type": "string", "description": "'active' (default), a month label like 'AUG2026', or 'all'"},
                "search": {"type": "string", "description": "Matches customer name or mobile"},
                "status": {"type": "string", "description": "fulfilment_status: BOOKED / NO_STOCK / ALLOTED / RETAILED / CANCELLED"},
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
}


# ---------------------------------------------------------------------------
# JSON-RPC dispatch
# ---------------------------------------------------------------------------

def _rpc_result(id_: Any, result: Any) -> dict:
    return {"jsonrpc": "2.0", "id": id_, "result": result}


def _rpc_error(id_: Any, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": id_, "error": {"code": code, "message": message}}


@router.post("")
def mcp_rpc(body: JsonRpcRequest) -> dict:
    if body.method == "initialize":
        return _rpc_result(body.id, {
            "protocolVersion": "2024-11-05",
            "serverInfo": {"name": "elite-dashboard-mcp", "version": "1.0.0"},
            "capabilities": {"tools": {}},
        })

    if body.method == "tools/list":
        return _rpc_result(body.id, {"tools": TOOLS})

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
