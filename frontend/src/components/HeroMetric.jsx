/**
 * The one figure the sheet exists for.
 *
 * This used to be a flex row that put the figure and a progress meter side by
 * side and let them fight for the same 24px gap: the label row above the meter
 * sat level with the middle of a 82px numeral, "41 units to goal" ran into the
 * right edge, and the meter itself was a rounded pill on a page with no other
 * rounded thing on it.
 *
 * Now it reads top to bottom the way the number is actually used: what it is,
 * what it says, what it means, and how far through the month that puts us. The
 * three supporting figures sit on the right, separated by hairlines rather than
 * by guesswork about gaps.
 */

import React from 'react';
import { n0, pct, money } from '../api/client';

export default function HeroMetric({ kpi = {} }) {
  const bookings = Number(kpi.bookings || 0);
  const target = Number(kpi.booking_target || kpi.target || 84);
  const ratio = target > 0 ? (bookings / target) * 100 : 0;
  const shortfall = Math.max(0, target - bookings);
  const collected = kpi.booking_amount_collected;

  // Colour is a judgement, not decoration: the bar is structural navy until
  // the month is genuinely at risk, and only then does it change.
  const meter = ratio >= 95 ? 'var(--good)'
              : ratio >= 60 ? 'var(--s1)'
              : 'var(--serious)';

  const stats = [
    { label: 'Achieved', value: pct(ratio), tone: 'var(--ink)' },
    {
      label: shortfall > 0 ? 'To goal' : 'Status',
      value: shortfall > 0 ? n0(shortfall) : 'Reached',
      tone: shortfall > 0 ? 'var(--serious)' : 'var(--good-text)',
    },
    ...(collected != null
      ? [{ label: 'Advance collected', value: money(collected), tone: 'var(--ink)' }]
      : []),
  ];

  return (
    <div className="hero-band">
      <div className="hero-label">Bookings this month</div>

      <div className="hero-row">
        {/* No caption under the figure. "Bookings against the month's target"
            said what the label above it already says, and it pushed the left
            column taller than the right, so the supporting figures bottom-
            aligned to a sentence instead of to the numeral they qualify. */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
          <span className="hero-figure">{n0(bookings)}</span>
          <span className="hero-of">/ {n0(target)}</span>
        </div>

        <div className="hero-stats">
          {stats.map(s => (
            <div key={s.label} className="hero-stat">
              <div className="hero-stat-label">{s.label}</div>
              <div className="hero-stat-value" style={{ color: s.tone }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* A rule, not a pill. The tick marks where the month actually stands, so
          the eye lands on the position rather than on the shape of the bar. */}
      <div className="hero-meter">
        <div
          className="hero-meter-fill"
          style={{ width: `${Math.min(100, Math.max(1.5, ratio))}%`, background: meter }}
        />
        <div
          className="hero-meter-tick"
          style={{ left: `${Math.min(100, Math.max(1.5, ratio))}%` }}
        />
      </div>
      <div className="hero-scale">
        <span>0</span>
        <span>Target {n0(target)}</span>
      </div>
    </div>
  );
}
