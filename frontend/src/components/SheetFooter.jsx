/**
 * The colophon.
 *
 * A report closes by saying what it is and how current it is. Nothing else.
 *
 * It used to close with a census - enquiries, bookings, retails, vehicles,
 * consultants - under a paragraph saying the figures redraw on their own. On
 * the Overview that census repeated the numbers directly above it, and because
 * the footer sits on every page, the Calls page signed off with a booking
 * count that had nothing to do with calls. Its stated job was provenance: a
 * reader who saw "0 vehicles on floor" would know the stock tab never loaded.
 * It could not do that job. `onFloor || null` turned a zero into null and the
 * cell was filtered out, so the one figure that would have raised the alarm
 * was the one guaranteed not to print. Missing data is the Data Quality
 * panel's work, where it can say what is missing and why.
 *
 * What this line was never good at is the thing a footer is for. It said
 * "Drawn live from the shared record" in three of the four states the live
 * connection can be in - including snapshot, while the rail beside it said
 * SNAPSHOT - and it never said when. A screenshot of this sheet travels, and
 * "live" in a picture taken yesterday tells the reader nothing. So it now
 * states the connection honestly and stamps the time the figures on screen
 * were drawn. When the link drops, the time stops advancing, which is
 * exactly the staleness a reader needs to see.
 */

import React from 'react';

/* The rail reports the connection as one of four states, and one of them is
   reported two ways: a failed connection on a serverless host arrives as
   state "live" with the text "snapshot". Read both, or a snapshot would be
   called live - which is the bug this replaced. */
function connection(liveStatus = {}) {
  const { state, text } = liveStatus;
  if (state === 'snapshot' || text === 'snapshot') return 'snapshot';
  if (state === 'live') return 'live';
  // "offline" is the browser failing to open the stream at all, and nothing
  // retries it - so it is not reconnecting, and saying so would be a smaller
  // version of the lie this replaced.
  if (state === 'down') return text === 'offline' ? 'offline' : 'down';
  return 'connecting';
}

const COPY = {
  live:       { label: 'Live',         stamp: 'updated' },
  down:       { label: 'Reconnecting', stamp: 'last updated' },
  offline:    { label: 'Offline',      stamp: 'last updated' },
  snapshot:   { label: 'Snapshot',     stamp: 'as of' },
  connecting: { label: 'Connecting',   stamp: null },
};

/* A clock time alone is ambiguous once the screenshot is a day old, so the
   date rides with it. The year does not: the period beside it carries one. */
function stamp(d) {
  if (!d || Number.isNaN(+d)) return null;
  const day = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${day}, ${time}`;
}

export default function SheetFooter({
  period = {},
  liveStatus = { state: 'off', text: '' },
  loadedAt = null,
}) {
  const span = (() => {
    const { period_start: a, period_end: b } = period;
    if (!a || !b) return null;
    const from = new Date(a), to = new Date(b);
    if (Number.isNaN(+from) || Number.isNaN(+to)) return null;
    return `${from.getUTCDate()}–${to.getUTCDate()} ${to.toLocaleDateString('en-IN', {
      month: 'long', year: 'numeric', timeZone: 'UTC',
    })}`;
  })();

  const state = connection(liveStatus);
  const copy = COPY[state];
  const when = copy.stamp ? stamp(loadedAt) : null;

  return (
    <footer className="colophon">
      <div className="colophon-id">
        <div className="colophon-name">Volkswagen Elite Motors</div>
        <div className="colophon-place">Hosur Road, Bengaluru</div>
      </div>

      <div className="colophon-meta">
        <div className="colophon-period">
          {period.label || '—'}{span ? ` · ${span}` : ''}
        </div>
        {/* aria-live so a reconnect is announced once, not silently swapped. */}
        <div className="colophon-source" data-state={state} aria-live="polite">
          <span className="colophon-dot" aria-hidden="true" />
          {copy.label}
          {when ? ` · ${copy.stamp} ${when}` : '…'}
        </div>
      </div>
    </footer>
  );
}
