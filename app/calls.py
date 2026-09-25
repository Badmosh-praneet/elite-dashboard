"""
The agent's call log, proxied.

Perfox answers the phone; the dashboard reports on the dealership. Until now
those were separate places to look, and nobody on the floor was going to open
two systems to find out what the agent had been telling customers all morning.

Two routes, both thin wrappers over the Perfox API:

    GET /api/calls                     what was taken, when, by whom, and why
    GET /api/calls/{id}/recordings     playback URLs for one call

They are proxies rather than a fetch from the browser for one reason: the
Perfox key. A call made from the page would ship that key inside the bundle,
where anyone who opens devtools has it - and it reads every customer
conversation the dealership has ever had. It stays in the environment on this
side and the browser never sees it.

Recordings are deliberately NOT fetched with the list and never cached. The
URLs Perfox returns are presigned and expire in fifteen minutes, so a URL
handed out with the list would be dead before most people scrolled to it. They
are fetched when a call is actually opened.
"""

import logging
import os
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Path

log = logging.getLogger("dsr.calls")

router = APIRouter(prefix="/api/calls", tags=["agent-calls"])

BASE = os.environ.get("PERFOX_API_BASE", "https://elite-motors-api.perfox.ai").rstrip("/")

# Long enough for a slow upstream, short enough that a hanging Perfox does not
# hold a dashboard request open until the gateway kills it at sixty seconds.
_TIMEOUT = httpx.Timeout(20.0, connect=8.0)


def _key() -> str:
    key = os.environ.get("PERFOX_API_KEY", "").strip()
    if not key:
        # 503 rather than 500: nothing is broken, the integration is simply not
        # configured, and the panel says so instead of showing a stack trace.
        raise HTTPException(
            status_code=503,
            detail="PERFOX_API_KEY is not set, so the agent's call log cannot be read.",
        )
    return key


def _get(path: str) -> Any:
    """One GET against Perfox, with its errors turned into ours."""
    try:
        with httpx.Client(timeout=_TIMEOUT) as client:
            r = client.get(f"{BASE}{path}",
                           headers={"Authorization": f"Bearer {_key()}"})
    except httpx.TimeoutException:
        raise HTTPException(504, "The agent's call service did not respond in time.")
    except httpx.HTTPError as exc:
        log.warning("perfox request failed: %s", exc)
        raise HTTPException(502, "Could not reach the agent's call service.")

    if r.status_code == 401:
        raise HTTPException(502, "The agent's call service rejected our API key.")
    if r.status_code == 404:
        raise HTTPException(404, "No such call.")
    if r.status_code >= 400:
        # The upstream body can carry the key back in an error echo, so it is
        # logged and not returned.
        log.warning("perfox %s -> %s: %s", path, r.status_code, r.text[:300])
        raise HTTPException(502, f"The agent's call service returned {r.status_code}.")

    try:
        return r.json()
    except ValueError:
        raise HTTPException(502, "The agent's call service returned something unreadable.")


def _seconds(v: Any) -> int:
    try:
        return max(0, int(v or 0))
    except (TypeError, ValueError):
        return 0


@router.get("")
def list_calls():
    """
    Every call the agent has handled, newest first.

    Passed through close to as received - this is Perfox's record, not ours,
    and rewriting it here would mean two places to change when they add a
    field. Only three things are done: the caller is flattened out of the
    nested end_user object so the table can read it, the order is fixed so the
    most recent call is at the top, and totals are counted once here rather
    than in the browser.

    `direction` is dropped. Every one of the 32 calls on record says "unknown",
    so a column of it would be a column of nothing.
    """
    payload = _get("/api/v1/calls")
    rows = payload.get("data") if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        rows = []

    calls = []
    for c in rows:
        user = c.get("end_user") or {}
        calls.append({
            "id": c.get("conversation_id"),
            "customer_id": c.get("customer_id"),
            "name": (user.get("name") or "").strip() or None,
            "phone": (user.get("phone") or "").strip() or None,
            "channel": c.get("channel"),
            "status": c.get("status"),
            "started_at": c.get("started_at"),
            "ended_at": c.get("ended_at"),
            "duration_seconds": _seconds(c.get("duration_seconds")),
            "has_recording": bool(c.get("has_recording")),
            "summary": (c.get("summary") or "").strip() or None,
        })

    calls.sort(key=lambda c: c.get("started_at") or "", reverse=True)

    return {
        "calls": calls,
        "total": len(calls),
        "recorded": sum(1 for c in calls if c["has_recording"]),
        "talk_seconds": sum(c["duration_seconds"] for c in calls),
        "channels": sorted({c["channel"] for c in calls if c["channel"]}),
    }


@router.get("/{conversation_id}/recordings")
def call_recordings(conversation_id: str = Path(..., min_length=8, max_length=64)):
    """
    Playback URLs for one call, fetched at the moment it is opened.

    A call has two legs - what the customer said and what the agent said - and
    they come back as separate audio files, so both are returned rather than
    guessing which one is wanted.

    `expires_in_seconds` is passed through so the page knows the links go stale.
    They are presigned and last fifteen minutes, which is why nothing here is
    cached: a cached URL is a broken player.
    """
    payload = _get(f"/api/v1/conversations/{conversation_id}/recordings")
    recs = payload.get("recordings") if isinstance(payload, dict) else None
    if not isinstance(recs, list):
        recs = []

    return {
        "id": conversation_id,
        "expires_in_seconds": payload.get("expires_in_seconds") if isinstance(payload, dict) else None,
        "recordings": [{"leg": r.get("leg"), "url": r.get("url")}
                       for r in recs if r.get("url")],
    }
