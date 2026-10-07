"""
Month-aware figures for the dashboard's AI agent (app/mcp_server.py).

The dashboard reports one month at a time: whichever month someone last picked
in its month selector becomes the active month for everybody (POST
/api/period/{label}/activate), and every dashboard view counts that month. An
agent answering "how many bookings this month?" from those views therefore
answered for whatever month was picked - August, while the calendar said
October.

These read any month the agent names, and default to the calendar month.
They count the way the views do - a row belongs to the month it is filed
under (period_id), which for the active month is exactly the dashboard's
is_current_period - so for the month on screen the figures match the
dashboard, and for any other month they are what the dashboard would show
with that month picked. Totals are counted here: a model asked to count fifty
rows gets it wrong.
"""
from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException

from .db import session

_IST = timezone(timedelta(hours=5, minutes=30))

_MONTH_NUMBERS = {name.lower(): i for i, name in enumerate(calendar.month_name) if name}
_MONTH_NUMBERS.update({name.lower(): i for i, name in enumerate(calendar.month_abbr) if name})
_MONTH_NUMBERS["sept"] = 9


def _today() -> date:
    return datetime.now(_IST).date()


def _label(d: date) -> str:
    return f"{calendar.month_abbr[d.month].upper()}{d.year}"


def resolve_month(text: str | None) -> dict:
    """A month as the agent names it: 'current' (default: the calendar month),
    'active' (the month the dashboard is set to), 'last', 'September',
    'sep 2026', 'SEP2026' or '2026-09'. A month named without a year is the
    latest one not after this month."""
    today = _today()
    raw = (text or "current").strip()
    t = raw.lower().replace("_", " ").strip()
    with session() as cx:
        periods = cx.execute(
            "SELECT period_id, label, period_start, period_end, is_active FROM dim_period").fetchall()
    active = next((p for p in periods if p["is_active"]), None)

    if t in ("active", "reporting", "dashboard", "selected", "reporting month"):
        if not active:
            raise HTTPException(400, "No month is active on the dashboard.")
        day = active["period_start"]
    elif t in ("current", "this month", "this", "now", "today", "calendar", "calendar month"):
        day = today
    elif t in ("last", "last month", "previous", "previous month"):
        day = today.replace(day=1) - timedelta(days=1)
    else:
        day = _parse_month(t, today)
        if day is None:
            raise HTTPException(400, f"Not a month: {raw!r}. Use current, last, a month name such as "
                                     "September, or a label such as SEP2026.")

    period = next((p for p in periods if p["period_start"] <= day <= p["period_end"]), None)
    first = day.replace(day=1)
    last = first.replace(day=calendar.monthrange(first.year, first.month)[1])
    return {
        "period_id": period["period_id"] if period else None,
        "month": period["label"] if period else _label(first),
        "from": (period["period_start"] if period else first).isoformat(),
        "to": (period["period_end"] if period else last).isoformat(),
        "calendar_month": _label(today),
        "dashboard_month": active["label"] if active else None,
    }


def _parse_month(t: str, today: date) -> date | None:
    t = t.replace(",", " ")
    # 2026-09
    parts = t.split("-")
    if len(parts) == 2 and all(p.isdigit() for p in parts) and len(parts[0]) == 4:
        y, m = int(parts[0]), int(parts[1])
        return date(y, m, 1) if 1 <= m <= 12 else None
    # SEP2026, sep 2026, september 2026, september
    letters = "".join(ch for ch in t if ch.isalpha())
    digits = "".join(ch for ch in t if ch.isdigit())
    m = _MONTH_NUMBERS.get(letters)
    if not m:
        return None
    if len(digits) == 4:
        return date(int(digits), m, 1)
    if digits:
        return None
    y = today.year if m <= today.month else today.year - 1
    return date(y, m, 1)


def _scope(month: str | None, date_from: str | None, date_to: str | None, date_col: str,
           alias: str) -> tuple[str, list, dict]:
    """The WHERE for a month (by the month a row is filed under) or for a span
    of days (on `date_col`). Days, when given, win."""
    from .crm_api import _day          # one reading of 'today' and YYYY-MM-DD for every tool
    lo, hi = _day(date_from), _day(date_to)
    if lo or hi:
        lo, hi = lo or hi, hi or lo
        if hi < lo:
            lo, hi = hi, lo
        today = _today()
        about = {"from": lo.isoformat(), "to": hi.isoformat(), "calendar_month": _label(today)}
        return f"{date_col}::date BETWEEN %s AND %s", [lo, hi], about
    m = resolve_month(month)
    if m["period_id"] is None:
        return "FALSE", [], {**m, "note": f"Nothing has been filed under {m['month']} yet."}
    return f"{alias}.period_id = %s", [m["period_id"]], m


def _note(about: dict) -> dict:
    """Say plainly which month a figure is for, when the dashboard is set to another."""
    month, shown = about.get("month"), about.get("dashboard_month")
    if month and shown and month != shown and "note" not in about:
        about = {**about, "note": f"These figures are for {month}. The dashboard is currently set to "
                                  f"{shown}, so its screens show {shown}."}
    return about


def _tally(rows: list[dict], key: str) -> dict[str, int]:
    out: dict[str, int] = {}
    for r in rows:
        k = r[key] or "Not recorded"
        out[k] = out.get(k, 0) + 1
    return dict(sorted(out.items(), key=lambda kv: (-kv[1], kv[0])))


def bookings_summary(month: str | None = None, date_from: str | None = None,
                     date_to: str | None = None) -> dict:
    """Bookings counted for a month or a span of days: the total, and by model
    (family, as the Inventory page counts them), by model as recorded, by
    consultant and by fulfilment status."""
    where, params, about = _scope(month, date_from, date_to, "b.booking_date", "b")
    with session() as cx:
        rows = cx.execute(f"""
            SELECT coalesce(m.family, 'Not recorded') AS family, coalesce(m.name, 'Not recorded') AS model,
                   coalesce(c.display_name, 'Not assigned') AS consultant,
                   coalesce(b.fulfilment_status::text, 'Not recorded') AS status
              FROM booking b
              LEFT JOIN dim_model m      ON m.model_id      = b.model_id
              LEFT JOIN dim_consultant c ON c.consultant_id = b.consultant_id
             WHERE {where}""", params).fetchall()
    return {**_note(about), "total": len(rows),
            "by_model": _tally(rows, "family"), "by_model_as_recorded": _tally(rows, "model"),
            "by_consultant": _tally(rows, "consultant"), "by_status": _tally(rows, "status")}


def leads_summary(month: str | None = None, date_from: str | None = None,
                  date_to: str | None = None) -> dict:
    """Enquiries counted for a month or a span of days: the total and how many
    qualified, by source channel (CRM, walk-in, tele...), by model and by
    consultant."""
    where, params, about = _scope(month, date_from, date_to, "l.created_at", "l")
    with session() as cx:
        rows = cx.execute(f"""
            SELECT coalesce(s.channel::text, 'Not recorded') AS source,
                   coalesce(m.family, 'Not recorded') AS model,
                   coalesce(c.display_name, 'Not assigned') AS consultant,
                   l.qualified_stage = 'Qualified' AS qualified
              FROM lead l
              LEFT JOIN dim_lead_source s ON s.source_id     = l.source_id
              LEFT JOIN dim_model m       ON m.model_id      = l.model_id
              LEFT JOIN dim_consultant c  ON c.consultant_id = l.consultant_id
             WHERE {where}""", params).fetchall()
    return {**_note(about), "total": len(rows), "qualified": sum(1 for r in rows if r["qualified"]),
            "by_source": _tally(rows, "source"), "by_model": _tally(rows, "model"),
            "by_consultant": _tally(rows, "consultant")}


def consultant_leaderboard(month: str | None = None, top: int = 10) -> dict:
    """Consultants ranked as the People page ranks them - by bookings, then
    retails - for any month, with their booking target where the month's
    workbook set one. Retails are the dashboard's own figure and come with the
    month the dashboard is set to only."""
    m = resolve_month(month)
    about = _note(m)
    if m["period_id"] is None:
        return {**about, "consultants": [], "note": f"Nothing has been filed under {m['month']} yet."}
    with session() as cx:
        rows = cx.execute("""
            SELECT c.display_name AS consultant, t.name AS team,
                   (SELECT count(*) FROM booking b
                     WHERE b.consultant_id = c.consultant_id AND b.period_id = %(p)s) AS bookings,
                   (SELECT count(*) FROM lead l
                     WHERE l.consultant_id = c.consultant_id AND l.period_id = %(p)s) AS enquiries,
                   (SELECT max(sc.booking_target) FROM target_consultant_scorecard sc
                     WHERE sc.consultant_id = c.consultant_id AND sc.period_id = %(p)s
                       AND sc.is_primary_channel) AS booking_target,
                   -- The People page breaks a tie on bookings by retails, which it
                   -- counts over every month; the same count, for the same order.
                   (SELECT count(*) FROM registration rg
                     WHERE rg.consultant_id = c.consultant_id
                       AND rg.status = 'REGISTERED') AS retails_ever
              FROM dim_consultant c
              LEFT JOIN dim_team t ON t.team_id = c.team_id
             WHERE c.is_active""", {"p": m["period_id"]}).fetchall()
        retails = {}
        if m["month"] == m["dashboard_month"]:
            retails = {r["consultant"]: r["retail_achieved"] for r in cx.execute(
                "SELECT consultant, retail_achieved FROM v_consultant_leaderboard").fetchall()}
    board = []
    for r in rows:
        if not (r["bookings"] or r["enquiries"] or r["booking_target"]):
            continue
        target = int(r["booking_target"]) if r["booking_target"] is not None else None
        entry = {"consultant": r["consultant"], "team": r["team"], "bookings": r["bookings"],
                 "booking_target": target,
                 "pct_of_target": round(100 * r["bookings"] / target) if target else None,
                 "enquiries": r["enquiries"], "_tie": r["retails_ever"]}
        if retails:
            entry["retails"] = int(retails.get(r["consultant"]) or 0)
        board.append(entry)
    # The page's order: bookings, then retails, then - as its rows arrive from
    # v_consultant_leaderboard - furthest behind booking target first.
    board.sort(key=lambda e: (-e["bookings"], -e["_tie"],
                              e["bookings"] - (e["booking_target"] or 0), e["consultant"]))
    for i, e in enumerate(board, 1):
        e["rank"] = i
        del e["_tie"]
    top = max(1, min(int(top or 10), 50))
    return {**about, "total_bookings": sum(e["bookings"] for e in board),
            "consultants_ranked": len(board), "consultants": board[:top]}
