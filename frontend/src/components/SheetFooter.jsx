/**
 * The colophon.
 *
 * This was two paragraphs explaining how to use the app - "the rail on the left
 * writes a booking, lead, test drive or allotment straight into the shared
 * record", and a line about editing tables in the cloud console. That is
 * onboarding copy, and it was the last thing anyone read on a sheet they had
 * just scrolled four thousand pixels of. A client reading it learns how the
 * software works rather than what the month did, and "cloud console" names an
 * implementation detail nobody outside the build needs.
 *
 * A report closes by saying what it is and what it was drawn from. So: the
 * dealership, the period it covers, and a census of what is actually in the
 * sheet - which doubles as a provenance check, because a reader who sees
 * "0 vehicles" knows the stock tab never loaded.
 */

import React from 'react';
import { n0 } from '../api/client';

export default function SheetFooter({
  kpi = {},
  period = {},
  board = [],
  liveStatus = { state: 'off', text: '' },
}) {
  const onFloor = Number(kpi.free_stock || 0) + Number(kpi.allotted_stock || 0);

  // Only count rows that actually carry a figure: a census that silently
  // includes placeholder consultants would defeat the point of printing one.
  const consultants = board.filter(
    c => Number(c.booking_target || 0) > 0 || Number(c.booking_achieved || 0) > 0,
  ).length;

  const census = [
    { n: kpi.enquiries, label: 'Enquiries' },
    { n: kpi.bookings, label: 'Bookings' },
    { n: kpi.retails, label: 'Retails' },
    { n: onFloor || null, label: 'Vehicles on floor' },
    { n: consultants || null, label: 'Consultants' },
  ].filter(c => c.n != null);

  const span = (() => {
    const { period_start: a, period_end: b } = period;
    if (!a || !b) return null;
    const from = new Date(a), to = new Date(b);
    if (Number.isNaN(+from) || Number.isNaN(+to)) return null;
    return `${from.getUTCDate()}–${to.getUTCDate()} ${to.toLocaleDateString('en-IN', {
      month: 'long', year: 'numeric', timeZone: 'UTC',
    })}`;
  })();

  const live = liveStatus.state === 'down';

  return (
    <footer className="colophon">
      <div className="colophon-head">
        <div>
          <div className="colophon-name">Volkswagen Elite Motors</div>
          <div className="colophon-place">Hosur Road, Bengaluru</div>
        </div>
        <div className="colophon-meta">
          <div className="colophon-period">
            {period.label || '—'}{span ? ` · ${span}` : ''}
          </div>
          <div className="colophon-source">
            {live
              ? 'Reconnecting to the shared record'
              : 'Drawn live from the shared record'}
          </div>
        </div>
      </div>

      <div className="colophon-census">
        {census.map(c => (
          <div key={c.label} className="colophon-cell">
            <div className="colophon-n">{n0(c.n)}</div>
            <div className="colophon-label">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="colophon-note">
        Every figure is read from the record at the moment the page draws, and
        redraws on its own when the record changes.
      </div>
    </footer>
  );
}
