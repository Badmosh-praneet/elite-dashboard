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
import re
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
    elif t in ("next", "next month", "coming month"):
        day = (today.replace(day=1) + timedelta(days=32)).replace(day=1)
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
    from .crm_api import _date_clause, span     # one reading of days and spans for every tool
    if not (date_from or date_to) and span(month):   # "this week" passed as a month
        date_from = date_to = month
    dated = _date_clause(f"{date_col}::date", date_from, date_to)
    if dated:
        lo, hi = dated[1]
        about = {"from": lo.isoformat(), "to": hi.isoformat(), "calendar_month": _label(_today())}
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


def when(about: dict) -> str:
    """The period of a figure in words: "September 2026", "8 Oct 2026",
    "5 Oct - 11 Oct 2026"."""
    if about.get("month") and "period_id" in about:
        try:
            return datetime.strptime(about["month"], "%b%Y").strftime("%B %Y")
        except ValueError:
            return about["month"]
    lo, hi = date.fromisoformat(about["from"]), date.fromisoformat(about["to"])
    if lo == hi:
        return f"{lo.day} {lo:%b %Y}"
    return f"{lo.day} {lo:%b} - {hi.day} {hi:%b %Y}"


def _listing(counts: dict[str, int], n: int = 8) -> str:
    items = [f"{k} {v}" for k, v in counts.items() if k not in ("Not recorded", "Not assigned")][:n]
    return ", ".join(items)


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
    out = {**_note(about), "total": len(rows),
           "by_model": _tally(rows, "family"), "by_model_as_recorded": _tally(rows, "model"),
           "by_consultant": _tally(rows, "consultant"), "by_status": _tally(rows, "status")}
    out["answer"] = (f"{when(about)}: {len(rows)} booking{'s' if len(rows) != 1 else ''}"
                     + (f" - by model: {_listing(out['by_model'])}." if rows else "."))
    return out


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
    out = {**_note(about), "total": len(rows), "qualified": sum(1 for r in rows if r["qualified"]),
           "by_source": _tally(rows, "source"), "by_model": _tally(rows, "model"),
           "by_consultant": _tally(rows, "consultant")}
    out["answer"] = (f"{when(about)}: {len(rows)} enquir{'ies' if len(rows) != 1 else 'y'}, "
                     f"{out['qualified']} qualified"
                     + (f" - by source: {_listing(out['by_source'])}." if rows else "."))
    return out


def consultant_leaderboard(month: str | None = None, top: int = 10) -> dict:
    """Consultants ranked as the People page ranks them - by bookings, then
    retails - for any month, with their booking target where the month's
    workbook set one. Retails are the dashboard's own figure and come with the
    month the dashboard is set to only."""
    m = resolve_month(month)
    about = _note(m)
    if m["period_id"] is None:
        return {**about, "consultants": [], "note": f"Nothing has been filed under {m['month']} yet.",
                "answer": f"No bookings recorded for {when(m)}."}
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
    shown = board[:top]
    answer = (f"Top {len(shown)} consultant{'s' if len(shown) != 1 else ''} by bookings, {when(m)}: "
              + "; ".join(f"{e['rank']}. {e['consultant']} - {e['bookings']}" for e in shown) + "."
              if shown and shown[0]["bookings"] else f"No bookings recorded for {when(m)}.")
    return {**about, "total_bookings": sum(e["bookings"] for e in board),
            "consultants_ranked": len(board), "consultants": shown, "answer": answer}


# ------------------------------------------------------------ rankings
#
# "Top 5 bookings", "top 10 consultants", "which model sells most": a chat
# model given lists answers these by taking the first rows - the newest - and
# calling them the top. Every ranking is made here, ranked and counted, with
# the sentence that answers it.

_TOP = {
    "consultants": ("bookings", "enquiries"),
    "models": ("bookings", "enquiries", "free_stock", "backorders"),
    "sources": ("enquiries", "qualified"),
    "bookings": ("amount",),
    "stock": ("age",),
    "test_drive_cars": ("test_drives",),
    "test_drive_executives": ("test_drives",),
}
_WHAT = {
    "consultant": "consultants", "executive": "consultants", "executives": "consultants",
    "sales executives": "consultants", "salespeople": "consultants", "team": "consultants", "people": "consultants",
    "model": "models", "car": "models", "cars": "models", "vehicles": "models",
    "source": "sources", "lead sources": "sources", "channel": "sources", "channels": "sources",
    "booking": "bookings", "order": "bookings", "orders": "bookings", "deals": "bookings",
    "inventory": "stock", "oldest stock": "stock", "ageing": "stock", "aging": "stock", "ageing stock": "stock",
    "test drive cars": "test_drive_cars", "test drives by car": "test_drive_cars",
    "test drive executives": "test_drive_executives", "test drives by executive": "test_drive_executives",
}
_BY = {
    "booking": "bookings", "sales": "bookings", "enquiry": "enquiries", "leads": "enquiries", "lead": "enquiries",
    "stock": "free_stock", "free stock": "free_stock", "backorder": "backorders", "no stock": "backorders",
    "value": "amount", "booking amount": "amount", "ageing": "age", "aging": "age", "days": "age",
    "test drives": "test_drives", "test drive": "test_drives", "drives": "test_drives",
}
_UNITS = {"bookings": "bookings", "enquiries": "enquiries", "qualified": "qualified enquiries",
          "free_stock": "cars in free stock", "backorders": "backorders", "test_drives": "test drive bookings"}


def _span_words(text: str | None) -> bool:
    from .crm_api import span
    return bool(span(text))


def top(what: str, by: str | None = None, month: str | None = None, date_from: str | None = None,
        date_to: str | None = None, n: int = 5) -> dict:
    """The top n of something, ranked: consultants (by bookings or enquiries),
    models (by bookings, enquiries, free stock or backorders), lead sources (by
    enquiries or qualified), single bookings (by amount), free stock (by age),
    and test drives by car or by executive. A month (default: this calendar
    month) or a span of days; stock is as it stands now."""
    w = re.sub(r"[\s_-]+", " ", (what or "").strip().lower())
    w = _WHAT.get(w, w.replace(" ", "_"))
    if w not in _TOP:
        raise HTTPException(400, "what is one of: consultants, models, sources, bookings, stock, "
                                 "test_drive_cars, test_drive_executives.")
    b = re.sub(r"[\s_-]+", " ", (by or _TOP[w][0]).strip().lower())
    b = _BY.get(b, b.replace(" ", "_"))
    if b not in _TOP[w]:
        raise HTTPException(400, f"{w} can be ranked by: {', '.join(_TOP[w])}.")
    n = max(1, min(int(n or 5), 50))

    rows: list[dict] = []
    about: dict = {}
    if w == "stock" or (w == "models" and b == "free_stock"):
        about = {"period": "now"}
        with session() as cx:
            if w == "stock":
                rows = [{"name": f"{r['model']} {r['variant'] or ''}".strip(), "value": r["stock_aging_days"],
                         "chassis": r["chassis_number"], "colour": r["colour"]}
                        for r in cx.execute("""
                            SELECT chassis_number, model, variant, colour, stock_aging_days FROM v_stock
                             WHERE stock_status = 'FREESTOCK' AND stock_aging_days IS NOT NULL
                             ORDER BY stock_aging_days DESC, chassis_number LIMIT %s""", (n,)).fetchall()]
            else:
                rows = [{"name": r["model"], "value": r["free_stock"]} for r in cx.execute(
                    "SELECT model, free_stock FROM v_model_position WHERE free_stock > 0 "
                    "ORDER BY free_stock DESC, model").fetchall()]
    elif w in ("test_drive_cars", "test_drive_executives"):
        from .crm_api import _date_clause, span
        if not (date_from or date_to) and span(month):
            date_from = date_to = month
        if date_from or date_to:
            lo, hi = _date_clause("x", date_from, date_to)[1]
            about = {"from": lo.isoformat(), "to": hi.isoformat()}
        else:
            about = resolve_month(month)
            lo, hi = date.fromisoformat(about["from"]), date.fromisoformat(about["to"])
        key = "car_id" if w == "test_drive_cars" else "coalesce(consultant, 'Not assigned')"
        with session() as cx:
            got = cx.execute(f"""
                SELECT {key} AS k, count(*) AS n FROM dsr.test_drive_booking
                 WHERE td_date BETWEEN %s AND %s AND status IN ('booked', 'attended', 'no_show')
                   AND start_time IS NOT NULL AND NOT sample
                 GROUP BY 1 ORDER BY 2 DESC, 1""", (lo, hi)).fetchall()
        from .test_drives import _cars
        names = {c["id"]: c["name"] for c in _cars()}
        rows = [{"name": names.get(r["k"], r["k"]) if w == "test_drive_cars" else r["k"], "value": r["n"]}
                for r in got]
        about["note"] = "Real test drives only; the sample drives are left out."
    elif w == "bookings":
        where, params, about = _scope(month, date_from, date_to, "b.booking_date", "b")
        with session() as cx:
            rows = [{"name": r["customer_name"] or "Customer not recorded", "value": float(r["booking_amount"]),
                     "model": r["model"], "consultant": r["consultant"],
                     "date": r["booking_date"].isoformat() if r["booking_date"] else None, "status": r["status"]}
                    for r in cx.execute(f"""
                        SELECT b.customer_name, m.name AS model, c.display_name AS consultant,
                               b.booking_amount, b.booking_date, b.fulfilment_status::text AS status
                          FROM booking b
                          LEFT JOIN dim_model m      ON m.model_id      = b.model_id
                          LEFT JOIN dim_consultant c ON c.consultant_id = b.consultant_id
                         WHERE {where} AND b.booking_amount IS NOT NULL
                         ORDER BY b.booking_amount DESC, b.booking_date DESC LIMIT %s""",
                        [*params, n]).fetchall()]
    elif w == "consultants" and b == "bookings" and not (date_from or date_to) and not _span_words(month):
        board = consultant_leaderboard(month, top=50)
        about = {k: v for k, v in board.items()
                 if k not in ("consultants", "answer", "total_bookings", "consultants_ranked")}
        rows = [{"name": e["consultant"], "value": e["bookings"], "booking_target": e["booking_target"],
                 "pct_of_target": e["pct_of_target"]} for e in board["consultants"] if e["bookings"]]
    elif w == "sources" and b == "qualified":
        where, params, about = _scope(month, date_from, date_to, "l.created_at", "l")
        with session() as cx:
            rows = [{"name": r["s"], "value": r["n"]} for r in cx.execute(f"""
                SELECT coalesce(s.channel::text, 'Not recorded') AS s, count(*) AS n
                  FROM lead l LEFT JOIN dim_lead_source s ON s.source_id = l.source_id
                 WHERE {where} AND l.qualified_stage = 'Qualified'
                 GROUP BY 1 ORDER BY 2 DESC, 1""", params).fetchall()]
    elif w == "models" and b == "backorders":
        where, params, about = _scope(month, date_from, date_to, "b.booking_date", "b")
        with session() as cx:
            rows = [{"name": r["f"], "value": r["n"]} for r in cx.execute(f"""
                SELECT coalesce(m.family, 'Not recorded') AS f, count(*) AS n
                  FROM booking b LEFT JOIN dim_model m ON m.model_id = b.model_id
                 WHERE {where} AND b.fulfilment_status::text = 'NO_STOCK'
                 GROUP BY 1 ORDER BY 2 DESC, 1""", params).fetchall()]
    else:
        source = bookings_summary if b == "bookings" else leads_summary
        summary = source(month, date_from, date_to)
        field = {"consultants": "by_consultant", "models": "by_model", "sources": "by_source"}[w]
        about = {k: v for k, v in summary.items()
                 if not k.startswith("by_") and k not in ("answer", "total", "qualified")}
        rows = [{"name": k, "value": v} for k, v in summary[field].items()]

    rows = [r for r in rows if r["name"] not in ("Not recorded", "Not assigned")][:n]
    for i, r in enumerate(rows, 1):
        r["rank"] = i
    period = "as it stands now" if about.get("period") == "now" else when(about)
    if w == "bookings":
        title = "biggest bookings by amount"
        fmt = lambda r: f"{r['name']} ({r['model']}) - Rs {r['value']:,.0f}"
    elif w == "stock":
        title = "oldest cars in free stock"
        fmt = lambda r: f"{r['name']} - {r['value']} days"
    else:
        label = {"consultants": "consultants", "models": "models", "sources": "lead sources",
                 "test_drive_cars": "cars", "test_drive_executives": "executives"}[w]
        title = f"{label} by {_UNITS.get(b, b)}"
        fmt = lambda r: f"{r['name']} - {r['value']}"
    if rows:
        answer = f"Top {len(rows)} {title}, {period}: " + "; ".join(f"{r['rank']}. {fmt(r)}" for r in rows) + "."
        if len(rows) < n:
            answer += f" Only {len(rows)} to rank."
    else:
        answer = f"Nothing to rank for {title}, {period}."
    keep = ("note", "dashboard_month", "calendar_month", "month")
    return {"ranking": title, "period": period, **{k: v for k, v in about.items() if k in keep},
            "rows": rows, "answer": answer}
