"""
Test drive board - PROTOTYPE.

A calendar of the showroom's days: test drives in thirty-minute slots on each
model's demo car, with the day's enquiries and bookings on the same car's row;
the requests the AI agent has taken on the phone; and the cars and team behind
it all.

Why it exists: the agent already promises test drives. Seven of the thirty-odd
calls in the log end with one - "scheduled a test drive for Friday", "booked a
test drive for the Virtus", "arranged for the sales team to finalize the
booking" - and none of those land anywhere. Perfox has no appointment object,
the agent's CRM endpoints cannot write a test drive, and the test_drive table
is a log of completed drives with a date and an odometer reading, not a
schedule: no time, no car, no showroom-or-home. So a promise made on a call
currently lives only in the call's summary.

What is real here and what is not:

  Real    the cars - every model family in the catalogue (dim_model) with
          the variants listed under it (dim_variant); the sales executives
          (dim_consultant, active only); the enquiries, bookings and recorded
          drives on the calendar, read and never written; and the test-drive
          requests, read live from the Perfox call log.

  Assumed one demo car per model family. The database records stock -
          FREESTOCK, ALLOTED or REGISTERED - with nothing marking a car as a
          demonstrator, so a family is what a test drive is booked on.

  Local   the test-drive bookings. They are kept in a JSON file on this
          machine, not in the database, because that database is shared with
          production and a prototype should not write to it. Making this real
          means a test_drive_booking table and an endpoint the agent can call.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Path as PathParam, Query
from pydantic import BaseModel, Field

from .db import session

# Its own prefix, deliberately. /api/test-drives already belongs to the Record
# drawer (entry.py), whose POST writes a completed drive to the live database.
# Sharing the path let that route answer this prototype's requests - harmlessly,
# since the shapes differ and it rejected them, but one shape-compatible request
# away from a prototype writing to production.
router = APIRouter(prefix="/api/test-drive-board", tags=["test drive board (prototype)"])

# Kept out of the repository (.gitignore: .local/), so a prototype's bookings
# can never be committed or deployed.
STORE = Path(os.environ.get(
    "TEST_DRIVE_STORE",
    Path(__file__).resolve().parent.parent / ".local" / "test_drives.json",
))
_lock = threading.Lock()

SLOT_START, SLOT_END, SLOT_MINUTES = "09:30", "19:00", 30

# The car ids the board used while its fleet was three placeholders. A booking
# made then still carries one, and is read as the family it stood for.
_LEGACY_CAR = {"taigun-topline": "taigun", "tiguan-rline": "tiguan", "virtus-gtplus": "virtus"}

_TEST_DRIVE = re.compile(r"test.?drive", re.I)
_WHEN = re.compile(
    r"\b(today|tomorrow|this weekend|next week|monday|tuesday|wednesday|thursday|"
    r"friday|saturday|sunday|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b", re.I)
_GEARBOX = re.compile(r"\b(DSG|AT|MT)\b", re.I)
# The DSR's trim shorthand, written out where a variant has no longer name.
_TRIM = {"CL": "Comfortline", "HL": "Highline"}


def _slots() -> list[str]:
    t = datetime.strptime(SLOT_START, "%H:%M")
    end = datetime.strptime(SLOT_END, "%H:%M")
    out = []
    while t < end:
        out.append(t.strftime("%H:%M"))
        t += timedelta(minutes=SLOT_MINUTES)
    return out


_SLOTS = _slots()


def _load() -> list[dict]:
    try:
        rows = json.loads(STORE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []
    for r in rows:
        r["car_id"] = _LEGACY_CAR.get(r.get("car_id"), r.get("car_id"))
    return rows


def _save(rows: list[dict]) -> None:
    STORE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STORE.with_suffix(".tmp")
    tmp.write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")
    tmp.replace(STORE)            # atomic on the same volume


# ---------------------------------------------------------------- the cars

def _slug(family: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", family.lower()).strip("-")


def _title(s: str) -> str:
    """'TIGUAN R-LINE' -> 'Tiguan R-Line'. Short, numbered and bracketed tokens
    are codes and keep their capitals: GTI, TSI, 1.5, (FL)."""
    def word(w: str) -> str:
        if len(w) <= 3 or re.search(r"[()\d]", w):
            return w.upper()
        return w[:1].upper() + w[1:].lower()
    return " ".join("-".join(word(p) for p in w.split("-")) for w in s.split())


def _variant_label(model: str, family: str, name: str | None, text: str | None) -> str:
    """The catalogue's description less the model it is listed under, so
    'TAIGUN 1.0L TSI 85kW AT Topline' under Taigun reads '1.0L TSI 85kW AT
    Topline'. With no description, the DSR's short name with its trim shorthand
    written out: 'CL MT' reads 'Comfortline MT'."""
    t = (text or "").strip()
    if t:
        for prefix in (model, family):
            if t.upper().startswith(prefix.upper() + " "):
                return t[len(prefix):].strip()
        return t
    words = [_TRIM.get(w.upper(), w) for w in (name or "").split()]
    return _title(" ".join(words)) if words else ""


_cars_cache: tuple[float, list[dict]] | None = None
_CARS_TTL = 300               # the catalogue changes with a workbook, not by the minute


def _cars() -> list[dict]:
    """The line-up, from the catalogue: one entry per model family, busiest
    first, with the variants listed under each of its models.

    The board used to carry three placeholder cars. The catalogue holds six
    models in five families and thirty-three variants, and every enquiry and
    booking names one of them, so that is the fleet the board draws. Kept for a
    few minutes, since every board load and every booking asks for it."""
    global _cars_cache
    if _cars_cache and time.monotonic() - _cars_cache[0] < _CARS_TTL:
        return _cars_cache[1]
    with session() as cx:
        rows = cx.execute("""
            SELECT m.family, m.name AS model, m.is_cbu,
                   v.variant_id, v.name AS variant, v.long_model_text, v.transmission
              FROM dim_model m
              LEFT JOIN dim_variant v ON v.model_id = m.model_id
             ORDER BY m.family, m.name, v.long_model_text NULLS LAST, v.name
        """).fetchall()
        # Busiest first, by everything on record against the family: its
        # enquiries, its bookings and its stock.
        busy = {r["family"]: r["n"] for r in cx.execute("""
            SELECT m.family, count(*) AS n
              FROM (SELECT model_id FROM lead    WHERE period_id IS NOT NULL
                    UNION ALL
                    SELECT model_id FROM booking WHERE period_id IS NOT NULL
                    UNION ALL
                    SELECT model_id FROM vehicle) x
              JOIN dim_model m ON m.model_id = x.model_id
             GROUP BY m.family
        """).fetchall()}

    families: dict[str, dict] = {}
    for r in rows:
        fam = families.setdefault(r["family"], {"imported": False, "models": {}})
        fam["imported"] = fam["imported"] or bool(r["is_cbu"])
        model = fam["models"].setdefault(r["model"], {
            "name": _title(r["model"]), "imported": bool(r["is_cbu"]), "variants": []})
        if r["variant_id"] is None:
            continue
        gear = _GEARBOX.search(f"{r['long_model_text'] or ''} {r['variant'] or ''}")
        model["variants"].append({
            "id": r["variant_id"],
            "name": _variant_label(r["model"], r["family"], r["variant"], r["long_model_text"]),
            "gearbox": (r["transmission"] or (gear.group(1) if gear else "")).upper(),
        })

    cars = []
    for family, fam in families.items():
        models = list(fam["models"].values())
        variants = [v for m in models for v in m["variants"]]
        gearboxes = [g for g in ("MT", "AT", "DSG") if any(v["gearbox"] == g for v in variants)]
        # Short enough for the board's car column; the gearboxes go with the
        # full variant list on the Cars tab.
        bits = (["Imported"] if fam["imported"] else []) + (
            [f"{len(variants)} variant{'' if len(variants) == 1 else 's'}"] if variants else [])
        cars.append({
            "id": _slug(family),
            "family": family,
            # A family of one model goes by that model (Tiguan R-Line, Golf
            # GTI); Taigun and the Taigun facelift share the family's name.
            "name": models[0]["name"] if len(models) == 1 else _title(family),
            "summary": " · ".join(bits),
            "gearboxes": gearboxes,
            "imported": fam["imported"],
            "models": models,
        })
    cars.sort(key=lambda c: (-busy.get(c["family"], 0), c["name"]))
    _cars_cache = (time.monotonic(), cars)
    return cars


def _car_for(family: str | None, text: str | None, cars: list[dict]) -> str | None:
    """The car a row belongs on: its model's family, or failing that the
    family its free-text model names ('Tiguan' is the Tiguan R-Line)."""
    if family:
        return _slug(family)
    t = (text or "").lower()
    for c in cars:
        if re.search(rf"\b{re.escape(c['family'].lower())}\b", t):
            return c["id"]
    return None


# ------------------------------------------------------------ the bookings

class BookingIn(BaseModel):
    car_id: str
    date: date
    start: str = Field(pattern=r"^\d{2}:\d{2}$")
    customer: str = Field(min_length=1, max_length=80)
    phone: str = Field(default="", max_length=20)
    consultant: str = Field(default="", max_length=60)
    location: Literal["Showroom", "Home"] = "Showroom"
    address: str = Field(default="", max_length=120)
    source: Literal["AI agent", "Staff", "Walk-in"] = "Staff"
    call_id: Optional[str] = Field(default=None, max_length=64)
    # The CRM enquiry this drive was booked from, so the enquiry can show it.
    enquiry_id: Optional[str] = Field(default=None, max_length=32)


class BookingPatch(BaseModel):
    status: Literal["booked", "attended", "no_show", "cancelled"]


@router.get("/setup")
def setup():
    """The cars, the team and the day's shape - everything the board draws
    before it has a single booking."""
    cars = _cars()
    with session() as cx:
        team = [r["display_name"] for r in cx.execute(
            "SELECT display_name FROM dim_consultant WHERE is_active ORDER BY display_name"
        ).fetchall()]
    return {
        "cars": cars,
        "consultants": team,
        "slots": _SLOTS,
        "slot_minutes": SLOT_MINUTES,
        "today": date.today().isoformat(),
        "store": "local",
    }


@router.get("")
def list_bookings(start: date = Query(...), days: int = Query(14, ge=1, le=62)):
    end = start + timedelta(days=days)
    with _lock:
        rows = _load()
    return {"bookings": [r for r in rows if start.isoformat() <= r["date"] < end.isoformat()]}


@router.post("", status_code=201)
def create_booking(b: BookingIn):
    if b.car_id not in {c["id"] for c in _cars()}:
        raise HTTPException(422, "No car with that id.")
    if b.start not in _SLOTS:
        raise HTTPException(422, f"Slots run every {SLOT_MINUTES} minutes from {SLOT_START} to {SLOT_END}.")
    row = {
        **b.model_dump(mode="json"),
        "id": uuid.uuid4().hex[:12],
        "status": "booked",
        "created_at": datetime.now().isoformat(timespec="seconds"),
    }
    with _lock:
        rows = _load()
        # One car, one customer, one slot. Cancelled bookings free the slot.
        clash = next((r for r in rows if r["car_id"] == b.car_id and r["date"] == row["date"]
                      and r["start"] == b.start and r["status"] != "cancelled"), None)
        if clash:
            raise HTTPException(409, f"{b.start} on that car is already booked for {clash['customer']}.")
        rows.append(row)
        _save(rows)
    return row


@router.patch("/{booking_id}")
def update_booking(p: BookingPatch, booking_id: str = PathParam(..., min_length=6, max_length=32)):
    with _lock:
        rows = _load()
        row = next((r for r in rows if r["id"] == booking_id), None)
        if not row:
            raise HTTPException(404, "No such booking.")
        row["status"] = p.status
        row["updated_at"] = datetime.now().isoformat(timespec="seconds")
        _save(rows)
    return row


# ------------------------------------------------- the CRM's own record

# Rows on the calendar are the dashboard's rows: a booking or an enquiry
# counts on its date only when it is filed under the month that date belongs
# to (see /activity). The calendar and the search read through the same three
# queries, so a record found by search is one the calendar shows.

_BOOKINGS_SQL = """
    SELECT b.booking_id, b.booking_date AS d, b.customer_name, b.mobile,
           m.family, m.name AS model, b.long_model_text, c.display_name AS consultant,
           b.booking_amount, b.fulfilment_status::text AS status,
           src.channel::text AS channel, b.origin::text AS origin
      FROM booking b
      JOIN dim_period p ON p.period_id = b.period_id
       AND b.booking_date BETWEEN p.period_start AND p.period_end
      LEFT JOIN dim_model m ON m.model_id = b.model_id
      LEFT JOIN dim_consultant c ON c.consultant_id = b.consultant_id
      LEFT JOIN dim_lead_source src ON src.source_id = b.source_id
     WHERE {where}
     ORDER BY {order}"""

# created_at::date, as Sales over time buckets it, so a day here and a day on
# the chart are the same day.
_ENQUIRIES_SQL = """
    SELECT l.lead_id, l.created_at::date AS d, l.lead_name, l.mobile,
           l.model_of_interest, m.family, m.name AS model, src.channel::text AS channel,
           COALESCE(c.display_name, l.lead_owner) AS consultant,
           l.lead_type, l.entered_by, l.origin::text AS origin
      FROM lead l
      JOIN dim_period p ON p.period_id = l.period_id
       AND l.created_at::date BETWEEN p.period_start AND p.period_end
      LEFT JOIN dim_model m ON m.model_id = l.model_id
      LEFT JOIN dim_consultant c ON c.consultant_id = l.consultant_id
      LEFT JOIN dim_lead_source src ON src.source_id = l.source_id
     WHERE {where}
     ORDER BY {order}"""

_RECORDED_SQL = """
    SELECT t.test_drive_id, t.td_date, t.lead_name, t.mobile, t.status,
           t.origin::text AS origin, t.model_of_interest,
           m.family, m.name AS model, c.display_name AS consultant,
           t.test_drive_number, t.start_km, t.end_km
      FROM test_drive t
      LEFT JOIN dim_model m ON m.model_id = t.model_id
      LEFT JOIN dim_consultant c ON c.consultant_id = t.consultant_id
     WHERE {where}
     ORDER BY {order}"""

# Channel groups in the dashboard's words - the same grouping Lead Sources
# uses, since some source names are salespeople rather than channels.
_CHANNEL = {"WALKIN": "Walk-in", "TELE": "Tele", "DIGITAL": "Digital", "REFERRAL": "Referral",
            "CRM": "CRM", "WORKSHOP": "Workshop", "HYPERLOCAL": "Hyperlocal", "OTHER": "Other"}
# What the agent records a caller as wanting. Workbook enquiries carry none.
_LEAD_TYPE = {"test_drive": "Test drive", "general_enquiry": "General enquiry", "rental": "Rental"}


def _query(cx, sql: str, where: str, params: tuple, order: str, limit: int | None):
    # `where` and `order` are fixed strings from this module; anything a user
    # typed travels in `params`.
    text = sql.format(where=where, order=order) + (f" LIMIT {int(limit)}" if limit else "")
    return cx.execute(text, params).fetchall()


def _booking_rows(cx, where, params, cars, order="b.booking_date, b.booking_id", limit=None) -> list[dict]:
    return [{
        "id": f"bk-{r['booking_id']}",
        "date": r["d"].isoformat(),
        "customer": (r["customer_name"] or "").strip() or "Unnamed",
        "phone": r["mobile"] or "",
        "model": r["model"] or "",
        "variant": (_variant_label(r["model"] or "", r["family"] or "", None, r["long_model_text"])
                    if r["long_model_text"] else ""),
        "car_id": _car_for(r["family"], r["long_model_text"], cars),
        "consultant": r["consultant"] or "",
        "amount": float(r["booking_amount"]) if r["booking_amount"] is not None else None,
        "status": r["status"] or "",
        "channel": _CHANNEL.get(r["channel"] or "", ""),
        "entered": "Record drawer" if r["origin"] == "MANUAL" else "Workbook upload",
    } for r in _query(cx, _BOOKINGS_SQL, where, params, order, limit)]


def _enquiry_rows(cx, where, params, cars, order="l.created_at, l.lead_id", limit=None) -> list[dict]:
    out = []
    for r in _query(cx, _ENQUIRIES_SQL, where, params, order, limit):
        by_agent = "agent" in (r["entered_by"] or "").lower()
        out.append({
            "id": f"enq-{r['lead_id']}",
            "date": r["d"].isoformat(),
            "name": re.sub(r"\s+\.$", "", (r["lead_name"] or "").strip()) or "Unnamed",
            "phone": r["mobile"] or "",
            "model": r["model"] or r["model_of_interest"] or "",
            "car_id": _car_for(r["family"], r["model_of_interest"], cars),
            "channel": _CHANNEL.get(r["channel"] or "", ""),
            "consultant": r["consultant"] or "",
            # The agent stamps its enquiries "AI Voice/Chat Agent" and says
            # what the caller wanted; a test drive is the one this board serves.
            "by_agent": by_agent,
            "wants_test_drive": r["lead_type"] == "test_drive",
            "request": _LEAD_TYPE.get(r["lead_type"] or "", ""),
            "entered": ("AI agent" if by_agent
                        else "Record drawer" if r["origin"] == "MANUAL" else "Workbook upload"),
        })
    return out


def _recorded_rows(cx, where, params, cars, order="t.td_date, t.test_drive_id", limit=None) -> list[dict]:
    return [{
        "id": f"crm-{r['test_drive_id']}",
        "date": r["td_date"].isoformat(),
        # The workbook writes " ." where a surname is missing ("Srinivasan .").
        "customer": re.sub(r"\s+\.$", "", (r["lead_name"] or "").strip()) or "Unnamed",
        "phone": r["mobile"] or "",
        "model": r["model"] or r["model_of_interest"] or "",
        "car_id": _car_for(r["family"], r["model_of_interest"], cars),
        "consultant": r["consultant"] or "",
        "status": r["status"] or "",
        # MANUAL rows come from the Record drawer; WORKBOOK rows from an upload.
        "entered": "Record drawer" if r["origin"] == "MANUAL" else "Workbook upload",
        "number": r["test_drive_number"] or "",
        "km": (r["end_km"] - r["start_km"])
              if r["end_km"] is not None and r["start_km"] is not None else None,
    } for r in _query(cx, _RECORDED_SQL, where, params, order, limit)]


def _person(phone: str | None, name: str | None) -> tuple[str, str] | None:
    """A phone and a first name together: one person. A phone alone is not
    enough - the agent's test calls put several names on one number."""
    digits = re.sub(r"\D", "", phone or "")[-10:]
    first = (name or "").strip().split(" ")[0].lower()
    return (digits, first) if len(digits) == 10 and first else None


def _link_enquiries(enquiries: list[dict], drives: list[dict]) -> None:
    """Give each enquiry the test drive booked for it, if there is one: a drive
    booked from that enquiry on this board, or one for the same person on or
    after the day they enquired. An enquiry that asked for a test drive and has
    none - or whose drive was a no-show - is flagged for follow-up: that is the
    promise nobody has kept yet."""
    live = sorted((d for d in drives if d.get("status") != "cancelled"),
                  key=lambda d: (d["date"], d.get("start", "")))
    by_enquiry = {d["enquiry_id"]: d for d in live if d.get("enquiry_id")}
    by_person: dict[tuple[str, str], list[dict]] = {}
    for d in live:
        key = _person(d.get("phone"), d.get("customer"))
        if key:
            by_person.setdefault(key, []).append(d)
    for e in enquiries:
        d = by_enquiry.get(e["id"])
        if d is None:
            key = _person(e["phone"], e["name"])
            d = next((x for x in by_person.get(key, []) if x["date"] >= e["date"]), None) if key else None
        e["test_drive"] = d
        e["follow_up"] = bool(e["wants_test_drive"] and (d is None or d.get("status") == "no_show"))


@router.get("/recorded")
def recorded_drives(start: date = Query(...), days: int = Query(31, ge=1, le=62)):
    """Test drives in the CRM's own record for these days - entered through the
    Record drawer, or carried in an uploaded workbook's test-drive tab.

    Read-only: the board shows them, it never writes to this table. They carry
    a date and a model but no time - the drawer records a drive that has
    happened, with its odometer readings, not a slot - so the board puts them
    in their car's All day lane rather than inventing a time. The drawer sends
    the live-update signal when it saves one, and the board refetches on it, so
    a drive recorded there appears here without a reload."""
    cars = _cars()
    end = start + timedelta(days=days)
    with session() as cx:
        return {"recorded": _recorded_rows(cx, "t.td_date >= %s AND t.td_date < %s", (start, end), cars)}


@router.get("/activity")
def sales_activity(start: date = Query(...), days: int = Query(31, ge=1, le=62)):
    """Bookings and enquiries on these days - the rows Sales over time plots.

    A row counts on its date only when it is filed under the month that date
    belongs to. That is how Sales over time reads a month - the month's own
    rows, on their dates - and it is what keeps the calendar in agreement with
    it: OCT2026 holds a second load of September's workbook, so counting by
    date alone would put every September booking on the calendar twice. Rows
    filed under no month (the Pending and Live carry-over tabs, the 2024
    enquiry archive) are not on the dashboard, so they are not here either.

    A month that does not exist yet is no gap. The first enquiry or booking
    dated in it creates it - the agent's insert trigger and the Record drawer's
    period_for() both do - so a new month's rows are filed under it and appear
    here like any other's.

    Days only, no times. Workbook rows carry a date and nothing else, and the
    agent's enquiries are stamped in two different clocks - some in UTC, some
    in India time - so a time of day would be wrong about as often as right.

    Each enquiry also carries the test drive booked for it on this board, if
    any, and whether it is still waiting for one.

    Read-only, like /recorded."""
    cars = _cars()
    end = start + timedelta(days=days)
    with session() as cx:
        bookings = _booking_rows(cx, "b.booking_date >= %s AND b.booking_date < %s", (start, end), cars)
        enquiries = _enquiry_rows(cx, "l.created_at::date >= %s AND l.created_at::date < %s", (start, end), cars)
    with _lock:
        drives = _load()
    _link_enquiries(enquiries, drives)
    return {"bookings": bookings, "enquiries": enquiries}


@router.get("/search")
def search(q: str = Query(..., min_length=2, max_length=60)):
    """Find a customer anywhere on the calendar, in any month: by name, or by
    four or more digits of their phone. Newest first.

    Searches what the calendar shows - bookings and enquiries filed under
    their month, the CRM's recorded drives, and the test drives booked here."""
    text = q.strip()
    digits = re.sub(r"\D", "", text)
    # A typed % or _ is a character to find, not a wildcard.
    name_like = "%" + re.sub(r"([\\%_])", r"\\\1", text) + "%"
    phone_like = f"%{digits}%" if len(digits) >= 4 else None

    def match(name_col: str, phone_col: str) -> tuple[str, tuple]:
        if phone_like:
            return (f"({name_col} ILIKE %s OR regexp_replace(coalesce({phone_col}, ''), '\\D', '', 'g') LIKE %s)",
                    (name_like, phone_like))
        return f"{name_col} ILIKE %s", (name_like,)

    cars = _cars()
    with session() as cx:
        w, a = match("b.customer_name", "b.mobile")
        bookings = _booking_rows(cx, w, a, cars, order="b.booking_date DESC, b.booking_id DESC", limit=15)
        w, a = match("l.lead_name", "l.mobile")
        enquiries = _enquiry_rows(cx, w, a, cars, order="l.created_at DESC, l.lead_id DESC", limit=15)
        w, a = match("t.lead_name", "t.mobile")
        recorded = _recorded_rows(cx, w, a, cars, order="t.td_date DESC, t.test_drive_id DESC", limit=10)
    with _lock:
        drives = _load()
    _link_enquiries(enquiries, drives)
    needle = text.lower()
    local = [d for d in drives
             if needle in (d.get("customer") or "").lower()
             or (phone_like and digits in re.sub(r"\D", "", d.get("phone") or ""))]
    results = ([{"kind": "bookings", "item": r} for r in bookings]
               + [{"kind": "enquiries", "item": r} for r in enquiries]
               + [{"kind": "drives", "item": r} for r in recorded]
               + [{"kind": "local", "item": r} for r in local])
    results.sort(key=lambda x: x["item"]["date"], reverse=True)
    return {"results": results[:30]}


# ------------------------------------------------------ the agent's promises

@router.get("/requests")
def agent_requests():
    """Test drives the agent promised on a call and nobody has scheduled.

    Read from the live call log: any call whose summary mentions a test drive,
    less the ones already turned into a booking. The car is the model family
    the summary names, and any day or time it mentions is passed on as a hint -
    the agent records "for Friday" in prose, not as a date."""
    try:
        from .calls import list_calls
        calls = list_calls().get("calls", [])
    except HTTPException as e:            # no Perfox key on this machine
        return {"requests": [], "unavailable": e.detail}
    cars = _cars()
    with _lock:
        booked = {r.get("call_id") for r in _load() if r.get("call_id") and r["status"] != "cancelled"}
    out = []
    for c in calls:
        summary = c.get("summary") or ""
        if not _TEST_DRIVE.search(summary) or c.get("id") in booked:
            continue
        when = _WHEN.search(summary)
        out.append({
            "call_id": c.get("id"),
            "called_at": c.get("started_at"),
            "name": c.get("name"),
            "phone": c.get("phone"),
            "channel": c.get("channel"),
            "car_id": _car_for(None, summary, cars),
            "when_hint": when.group(1) if when else None,
            "summary": summary,
        })
    return {"requests": out}
