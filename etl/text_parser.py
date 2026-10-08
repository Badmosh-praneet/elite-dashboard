"""
Text and CSV report ingestion parser for Volkswagen Elite Motors CRM.

Supports:
- CSV (.csv), TSV (.tsv), and Text (.txt) reports
- Automatic encoding detection (UTF-8, UTF-8-BOM, Latin-1, CP1252)
- Delimiter detection (comma, tab, semicolon, pipe)
- Multi-section DSR text reports (converted into in-memory openpyxl workbook)
- Single-table auto-detection: Bookings, Leads, Vehicles/Stock, Test Drives
"""

from __future__ import annotations

import csv
import io
import re
from datetime import date, datetime
from typing import Any

import openpyxl
import psycopg

from app.db import DSN, connect as db_connect
from etl import dimensions as dims
from etl import normalize as nz
from etl.load_dsr import Loader


def decode_bytes(content: bytes) -> str:
    """Safely decode raw bytes across common text encodings."""
    for enc in ("utf-8-sig", "utf-8", "latin-1", "cp1252"):
        try:
            return content.decode(enc)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="replace")


def detect_delimiter(text: str) -> str:
    """Sniff delimiter from first few lines, falling back to comma."""
    sample = "\n".join(text.splitlines()[:15])
    try:
        sniffer = csv.Sniffer()
        dialect = sniffer.sniff(sample, delimiters=[",", "\t", ";", "|"])
        return dialect.delimiter
    except Exception:
        # Heuristic count
        counts = {
            ",": sample.count(","),
            "\t": sample.count("\t"),
            ";": sample.count(";"),
            "|": sample.count("|"),
        }
        best = max(counts, key=counts.get)
        return best if counts[best] > 2 else ","


def parse_csv_rows(text: str, delimiter: str | None = None) -> list[list[str]]:
    """Parse delimited text into clean list of string lists."""
    delim = delimiter or detect_delimiter(text)
    reader = csv.reader(io.StringIO(text), delimiter=delim)
    return [[col.strip() for col in row] for row in reader if any(col.strip() for col in row)]


def is_multi_section_dsr(text: str) -> bool:
    """Check if the text file has multiple explicit sheet or table headers."""
    pattern = r"(?im)^(?:\s*\[\s*(?:sheet|table)?\s*:?\s*([a-z0-9 &_-]+)\s*\]|\s*(?:===+|---+|###+)\s*([a-z0-9 &_-]+)\s*(?:===+|---+|###+)|\s*#\s*(?:sheet|table):\s*([a-z0-9 &_-]+))"
    return len(re.findall(pattern, text)) >= 2


def build_workbook_from_sections(text: str) -> openpyxl.Workbook:
    """
    Parse a multi-section text file into an in-memory openpyxl Workbook.
    Recognizes sections like:
    [Sheet: Booking & Alloted]
    === Leads ===
    # Sheet: Stock & Allotted
    """
    wb = openpyxl.Workbook()
    default_sheet = wb.active

    pattern = r"(?im)^(?:\s*\[\s*(?:sheet|table)?\s*:?\s*([a-z0-9 &_-]+)\s*\]|\s*(?:===+|---+|###+)\s*([a-z0-9 &_-]+)\s*(?:===+|---+|###+)|\s*#\s*(?:sheet|table):\s*([a-z0-9 &_-]+))"

    sections: list[tuple[str, list[str]]] = []
    current_title = "Sheet1"
    current_lines: list[str] = []

    for line in text.splitlines():
        match = re.match(pattern, line)
        if match:
            title = next(g for g in match.groups() if g).strip()
            if current_lines and current_title:
                sections.append((current_title, current_lines))
                current_lines = []
            current_title = title
        else:
            current_lines.append(line)

    if current_lines:
        sections.append((current_title, current_lines))

    for title, lines in sections:
        ws = wb.create_sheet(title=title)
        delim = detect_delimiter("\n".join(lines[:10]))
        reader = csv.reader(io.StringIO("\n".join(lines)), delimiter=delim)
        for row in reader:
            if any(c.strip() for c in row):
                ws.append(row)

    if default_sheet in wb.worksheets and len(wb.worksheets) > 1:
        wb.remove(default_sheet)

    return wb


def detect_table_type(headers: list[str], explicit_type: str | None = None) -> str:
    """Determine whether a single tabular CSV/TXT represents bookings, leads, stock, or test drives."""
    if explicit_type and explicit_type.lower() in ("booking", "lead", "vehicle", "test_drive", "stock"):
        t = explicit_type.lower()
        return "vehicle" if t == "stock" else t

    norm = [re.sub(r"[^a-z0-9]", "", h.lower()) for h in headers]
    s = " ".join(norm)

    if any(k in s for k in ("chassis", "vin", "enginenumber", "billingdate", "stockstatus", "agingdays")):
        return "vehicle"
    if any(k in s for k in ("testdrive", "tddate", "startkm", "endkm", "distancekm")):
        return "test_drive"
    if any(k in s for k in ("contract", "bookingamount", "deposit", "fulfilment", "crmentry", "alloted")):
        return "booking"
    if any(k in s for k in ("leadtype", "rating", "qualifiedstage", "enquiry", "leadowner")):
        return "lead"

    # Secondary heuristic
    if "booking" in s or "customer" in s:
        return "booking"
    if "lead" in s or "source" in s:
        return "lead"

    return "booking"


def find_column(headers: list[str], *aliases: str) -> int | None:
    """Find index of header matching any of the alias keywords."""
    norm_headers = [re.sub(r"[^a-z0-9]", "", h.lower()) for h in headers]
    for alias in aliases:
        norm_alias = re.sub(r"[^a-z0-9]", "", alias.lower())
        for i, h in enumerate(norm_headers):
            if norm_alias == h or norm_alias in h:
                return i
    return None


def parse_cell_date(val: Any) -> date | None:
    """Parse date from common CSV string formats."""
    d = nz.as_date(val)
    if d:
        return d
    s = str(val or "").strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y", "%d %b %Y", "%d-%b-%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except Exception:
            continue
    return None


def ingest_text_report(
    content: bytes,
    filename: str,
    period_label: str,
    period_start: date,
    period_end: date,
    uploaded_by: str = "Reporting Agent",
    table_type: str | None = None,
) -> dict[str, Any]:
    """
    Main entry point for ingesting CSV and TXT report files.
    """
    text = decode_bytes(content)
    if not text.strip():
        raise ValueError("Uploaded report file is empty.")

    # 1. Multi-section DSR Text file
    if is_multi_section_dsr(text):
        wb = build_workbook_from_sections(text)
        with db_connect(autocommit=True) as cx:
            loader = Loader(cx, wb, period_label, period_start, period_end)
            counts = loader.run()
            return {
                "detected_format": "multi_section_dsr_text",
                "counts": counts,
                "warnings": loader.warnings,
                "sheets_parsed": [ws.title for ws in wb.worksheets],
            }

    # 2. Tabular CSV or Delimited TXT file
    delimiter = detect_delimiter(text)
    rows = parse_csv_rows(text, delimiter=delimiter)
    if not rows:
        raise ValueError("No tabular data found in file.")

    headers = rows[0]
    data_rows = rows[1:]
    kind = detect_table_type(headers, table_type)

    with db_connect(autocommit=True) as cx:
        # Ensure period exists in dim_period
        p_row = cx.execute("""
            INSERT INTO dim_period (label, period_start, period_end)
            VALUES (%s, %s, %s)
            ON CONFLICT (label) DO UPDATE SET period_start = EXCLUDED.period_start,
                                             period_end = EXCLUDED.period_end
            RETURNING period_id
        """, (period_label, period_start, period_end)).fetchone()
        period_id = p_row[0]

        # Activate this period
        cx.execute("UPDATE dim_period SET is_active = false WHERE is_active")
        cx.execute("UPDATE dim_period SET is_active = true WHERE period_id = %s", (period_id,))

        counts: dict[str, int] = {}
        inserted = 0

        if kind == "booking":
            col_date = find_column(headers, "date", "bookingdate", "dob")
            col_cust = find_column(headers, "customer", "customername", "client", "name")
            col_mobile = find_column(headers, "mobile", "phone", "contact")
            col_cons = find_column(headers, "consultant", "sc", "executive", "salesexec")
            col_model = find_column(headers, "model", "car", "vehicle")
            col_var = find_column(headers, "variant", "trim", "version")
            col_col = find_column(headers, "colour", "color", "exterior")
            col_my = find_column(headers, "modelyear", "my", "year")
            col_stat = find_column(headers, "status", "fulfilment", "fulfilmentstatus")
            col_crm = find_column(headers, "crmentry", "crmdone", "incrm", "crm")
            col_amt = find_column(headers, "amount", "bookingamount", "deposit", "value")
            col_src = find_column(headers, "source", "channel", "leadsource")
            col_notes = find_column(headers, "notes", "remarks", "comment")

            for r in data_rows:
                def get_val(idx: int | None):
                    return r[idx].strip() if idx is not None and idx < len(r) and r[idx].strip() else None

                cust_name = get_val(col_cust)
                if not cust_name:
                    continue

                b_date = parse_cell_date(get_val(col_date)) or date.today()
                consultant_name = get_val(col_cons)
                consultant_id = dims.resolve_consultant(cx, consultant_name, activate=True) if consultant_name else None
                model_name = get_val(col_model) or "TAIGUN"
                model_id = dims.resolve_model(cx, model_name)
                variant_name = get_val(col_var)
                variant_id = dims.resolve_variant(cx, model_name, variant_name) if variant_name else None
                colour_name = get_val(col_col)
                colour_id = dims.resolve_colour(cx, colour_name) if colour_name else None
                source_name = get_val(col_src)
                source_id = dims.resolve_source(cx, source_name) if source_name else None

                fulfilment = nz.fulfilment_status(get_val(col_stat)) or "BOOKED"
                crm_done = nz.as_bool(get_val(col_crm)) or False
                amount = nz.as_num(get_val(col_amt))
                my = nz.as_int(get_val(col_my)) or date.today().year
                mobile = nz.mobile(get_val(col_mobile))
                notes = get_val(col_notes)

                # Check if in active period
                in_current = (period_start <= b_date <= period_end)

                cx.execute("""
                    INSERT INTO booking (
                        booking_date, customer_name, mobile, source_id,
                        consultant_id, team_id, model_id, variant_id,
                        colour_id, model_year, fulfilment_status,
                        car_origin, crm_entry_done, booking_amount, notes,
                        source_sheet, period_id, is_current_period,
                        origin, entered_by
                    ) VALUES (
                        %s, %s, %s, %s,
                        %s, (SELECT team_id FROM dim_consultant WHERE consultant_id = %s),
                        %s, %s, %s, %s, %s,
                        'FRESH_CAR', %s, %s, %s,
                        %s, %s, %s,
                        'WORKBOOK', %s
                    )
                """, (
                    b_date, cust_name, mobile, source_id,
                    consultant_id, consultant_id,
                    model_id, variant_id, colour_id, my, fulfilment,
                    crm_done, amount, notes,
                    f"Uploaded {filename}", period_id, in_current,
                    uploaded_by,
                ))
                inserted += 1

            # Realign fact rows for active period
            cx.execute("UPDATE booking SET is_current_period = COALESCE(period_id = %s, false)", (period_id,))
            counts["booking"] = inserted

        elif kind == "lead":
            col_date = find_column(headers, "date", "createdon", "createdat")
            col_name = find_column(headers, "name", "leadname", "customer")
            col_mobile = find_column(headers, "mobile", "phone")
            col_cons = find_column(headers, "consultant", "sc", "leadowner")
            col_model = find_column(headers, "model", "modelofinterest")
            col_src = find_column(headers, "source", "leadtype", "channel")
            col_qual = find_column(headers, "qualified", "stage", "qualifiedstage")
            col_rating = find_column(headers, "rating")

            for r in data_rows:
                def get_val(idx: int | None):
                    return r[idx].strip() if idx is not None and idx < len(r) and r[idx].strip() else None

                name = get_val(col_name)
                if not name:
                    continue

                l_date = parse_cell_date(get_val(col_date)) or date.today()
                consultant_name = get_val(col_cons)
                consultant_id = dims.resolve_consultant(cx, consultant_name, activate=True) if consultant_name else None
                model_name = get_val(col_model) or "TAIGUN"
                model_id = dims.resolve_model(cx, nz.model_from_text(model_name))
                source_name = get_val(col_src)
                source_id = dims.resolve_source(cx, source_name) if source_name else None
                mobile = nz.mobile(get_val(col_mobile))
                qualified = nz.as_bool(get_val(col_qual))
                stage = "Qualified" if qualified else "New"
                rating = get_val(col_rating) or "HOT"
                in_current = (period_start <= l_date <= period_end)

                cx.execute("""
                    INSERT INTO lead (
                        lead_name, mobile, source_id, lead_type,
                        model_of_interest, model_id, consultant_id, rating,
                        qualified_stage, created_at, period_id,
                        is_current_period, origin, entered_by
                    ) VALUES (
                        %s, %s, %s, %s,
                        %s, %s, %s, %s,
                        %s, %s, %s,
                        %s, 'WORKBOOK', %s
                    )
                """, (
                    name, mobile, source_id, source_name or "WALKIN",
                    model_name, model_id, consultant_id, rating,
                    stage, l_date, period_id,
                    in_current, uploaded_by,
                ))
                inserted += 1

            cx.execute("UPDATE lead SET is_current_period = COALESCE(period_id = %s, false)", (period_id,))
            counts["lead"] = inserted

        elif kind == "vehicle":
            col_chassis = find_column(headers, "chassis", "vin", "chassisnumber")
            col_model = find_column(headers, "model", "car")
            col_var = find_column(headers, "variant", "trim")
            col_col = find_column(headers, "colour", "color")
            col_stat = find_column(headers, "status", "stockstatus")
            col_aging = find_column(headers, "aging", "agingdays", "stockagingdays")
            col_bill = find_column(headers, "billingdate", "billing", "billdate")

            for r in data_rows:
                def get_val(idx: int | None):
                    return r[idx].strip() if idx is not None and idx < len(r) and r[idx].strip() else None

                chassis = nz.chassis(get_val(col_chassis))
                if not chassis:        # blank, or not a chassis number: never a new "car"
                    if get_val(col_chassis):
                        counts["vehicle_skipped_not_chassis"] = counts.get("vehicle_skipped_not_chassis", 0) + 1
                    continue

                model_name = get_val(col_model) or "TAIGUN"
                model_id = dims.resolve_model(cx, model_name)
                variant_name = get_val(col_var)
                variant_id = dims.resolve_variant(cx, model_name, variant_name) if variant_name else None
                colour_name = get_val(col_col)
                colour_id = dims.resolve_colour(cx, colour_name) if colour_name else None
                status = nz.stock_status(get_val(col_stat)) or "FREESTOCK"
                aging = nz.as_int(get_val(col_aging)) or 0
                billing = parse_cell_date(get_val(col_bill)) or date.today()

                cx.execute("""
                    INSERT INTO vehicle (
                        chassis_number, model_id, variant_id, colour_id,
                        billing_date, stock_aging_days, stock_status
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (chassis_number) DO UPDATE SET
                        stock_status = EXCLUDED.stock_status,
                        stock_aging_days = EXCLUDED.stock_aging_days,
                        model_id = COALESCE(vehicle.model_id, EXCLUDED.model_id),
                        variant_id = COALESCE(vehicle.variant_id, EXCLUDED.variant_id),
                        colour_id = COALESCE(vehicle.colour_id, EXCLUDED.colour_id)
                """, (chassis, model_id, variant_id, colour_id, billing, aging, status))
                inserted += 1

            counts["vehicle"] = inserted

        return {
            "detected_format": f"delimited_{delimiter}",
            "detected_table": kind,
            "counts": counts,
            "total_rows_imported": inserted,
        }
