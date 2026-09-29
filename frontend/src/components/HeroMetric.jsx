/**
 * The one figure the sheet exists for.
 *
 * It reads top to bottom the way the number is actually used: what it is, what
 * it says, what it means, and how far through the month that puts us. The
 * supporting figures sit on the right, separated by hairlines rather than by
 * guesswork about gaps.
 *
 * What it could not do until now was tell the time. It said "Bookings this
 * month" and "To goal: 42" while showing August on the twenty-ninth of
 * September - a month that had been over for four weeks, described as if the
 * gap could still be closed. And in a month that is still running it could not
 * say whether the figure was good: fifty per cent on the fifteenth is on track
 * and fifty per cent on the twenty-eighth is a crisis, and it coloured both the
 * same, because its only judgement was the raw ratio. On the first of the month
 * that judgement painted "To goal: 84" in the alarm colour, for a month that
 * had not had a chance to go wrong.
 *
 * So the hero now knows which kind of month it is looking at.
 *
 *   A closed month has a result. The second figure says how far over or short
 *   of target it finished, and the meter is coloured by that result.
 *
 *   A running month has a pace. The tick on the meter marks where bookings
 *   should stand by now if the target were spread evenly across the days; the
 *   gap between the bar and the tick is the whole story, and the second figure
 *   puts a number on it. The tick used to sit exactly where the bar ended,
 *   which drew one fact twice.
 *
 *   The first two days of a month are too few to judge, so they get neither
 *   the pace nor the alarm - just the distance to target, in plain ink.
 *
 * "By now" means the last day with anything in the record, not today. The
 * workbook is filled in after the fact, and a day nobody has entered yet is
 * not a day of lost bookings; measuring against the calendar would call every
 * gap in data entry a gap in selling.
 */

import React from 'react';
import { n0, pct, money } from '../api/client';
import HeroField from './HeroField';
import Figure from './Figure';

const DAY = 86400000;

/* Dates arrive as YYYY-MM-DD. They are periods, not instants, so they are read
   as whole UTC days - a timezone must never move the first of the month back
   into the last day of the one before. */
const dayOf = s => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY : null;
};
const today = () => {
  const n = new Date();
  return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / DAY;
};
const dateLabel = (day, opts) =>
  new Date(day * DAY).toLocaleDateString('en-IN', { ...opts, timeZone: 'UTC' });

/* The last day anything was recorded, bookings or enquiries. Enquiries arrive
   almost every day, so their last date is the best evidence of how far the
   record has been filled in - a quiet day for bookings alone would pull it
   back. */
function lastRecorded(trends = {}) {
  let last = null;
  for (const series of [trends.bookings, trends.enquiries]) {
    for (const p of series || []) {
      if ((Number(p.n) || 0) <= 0) continue;
      const d = dayOf(p.d);
      if (d != null && (last == null || d > last)) last = d;
    }
  }
  return last;
}

/* Where in its own month the active period stands. */
export function monthState(period = {}, trends = {}, now = today()) {
  const start = dayOf(period.period_start);
  const end = dayOf(period.period_end);
  if (start == null || end == null || end < start) return null;
  const recorded = lastRecorded(trends);
  const through = recorded == null ? null : Math.min(Math.max(recorded, start), end);
  return {
    total: end - start + 1,
    closed: now > end,
    days: through == null ? 0 : through - start + 1,
    name: dateLabel(end, { month: 'long', year: 'numeric' }),
    through: through == null ? null : dateLabel(through, { day: 'numeric', month: 'short' }),
  };
}

/* Fewer days than this and "pace" is mostly noise: two bookings on day one is
   either far ahead or far behind depending on nothing at all. */
const MIN_PACE_DAYS = 3;

export default function HeroMetric({ kpi = {}, period = {}, trends = {} }) {
  const bookings = Number(kpi.bookings || 0);
  const target = Number(kpi.booking_target || 0);
  const ratio = target > 0 ? (bookings / target) * 100 : 0;
  const shortfall = Math.max(0, target - bookings);
  const collected = kpi.booking_amount_collected;

  const month = monthState(period, trends);
  const closed = !!month?.closed;
  const pacing = !!month && !closed && target > 0 && month.days >= MIN_PACE_DAYS;
  const expected = pacing ? (target * month.days) / month.total : null;
  const behindBy = pacing ? expected - bookings : 0;

  // How far one number is from another, said in words a manager would use.
  const by = (n, word) => <><Figure value={n} format={n0} /> {word}</>;

  /* One judgement, decided once, and both the words and the meter read it.
     They used to be decided separately and came apart at the edges: fifty
     bookings against a pace of 50.4 read "On pace" in green over a navy bar,
     because the words forgave half a booking and the bar did not. Now there is
     one place that decides, and nothing downstream can disagree with it.

     A closed month is judged on its result, a running one on its pace, and one
     too young to judge is not judged at all. "Near" is within a tenth - a month
     three bookings behind a pace of fifty is not in trouble, and is not
     painted as though it were. */
  const NEAR = 0.9;
  const goal = closed ? target : expected;
  const standing = !(closed || pacing) || !(goal > 0) ? 'neutral'
    : bookings >= goal - (pacing ? 0.5 : 0) ? 'good'
    : bookings >= NEAR * goal ? 'near'
    : 'bad';
  const TONE = { good: 'var(--good-text)', near: 'var(--ink)', bad: 'var(--serious)', neutral: 'var(--ink)' };
  // Colour is a judgement, not decoration. Near is left in the structural navy.
  const METER = { good: 'var(--good)', near: 'var(--s1)', bad: 'var(--serious)', neutral: 'var(--s1)' };

  let verdict;
  if (closed && target > 0) {
    const diff = bookings - target;
    verdict = {
      label: 'Result',
      node: diff === 0 ? 'Target met' : diff > 0 ? by(diff, 'over') : by(-diff, 'short'),
    };
  } else if (pacing) {
    const gap = Math.max(1, Math.round(Math.abs(behindBy)));
    verdict = {
      label: 'Pace',
      // Same boundary the standing uses: within half a booking is on pace.
      node: Math.abs(behindBy) <= 0.5 ? 'On pace'
        : behindBy > 0 ? by(gap, 'behind') : by(gap, 'ahead'),
    };
  } else {
    // Too early to judge, or no calendar to judge against: the distance to
    // target, in plain ink rather than the alarm colour.
    verdict = shortfall > 0
      ? { label: 'To goal', node: <Figure value={shortfall} format={n0} /> }
      : { label: 'Status', node: 'Reached' };
  }
  verdict.tone = shortfall > 0 || standing !== 'neutral' ? TONE[standing] : TONE.good;
  const meter = METER[standing];

  const context = !month ? null
    : closed ? 'Month closed'
    : pacing ? `Day ${month.days} of ${month.total} · ${n0(Math.round(expected))} expected`
    : month.days > 0 ? `Day ${month.days} of ${month.total}` : null;
  const contextHint = pacing && month.through
    ? `Pace is measured to ${month.through}, the last day with figures in the record, not to today.`
    : undefined;

  // These all move when a booking lands, so they count with the figure rather
  // than snapping beside a number that is visibly counting.
  const stats = [
    ...(target > 0
      ? [{ label: 'Achieved', node: <Figure value={ratio} format={pct} decimals={1} />, tone: 'var(--ink)' }]
      : []),
    ...(target > 0 ? [verdict] : []),
    ...(collected != null
      ? [{ label: 'Advance collected', node: <Figure value={Number(collected)} format={money} />, tone: 'var(--ink)' }]
      : []),
  ];

  const fill = Math.min(100, Math.max(1.5, ratio));

  return (
    <div className="hero-band">
      <HeroField />
      <div className="hero-head">
        <div className="hero-label">
          {month ? `Bookings · ${month.name}` : 'Bookings this month'}
        </div>
        {context && <div className="hero-context" title={contextHint}>{context}</div>}
      </div>

      <div className="hero-row">
        {/* No caption under the figure. "Bookings against the month's target"
            said what the label above it already says, and it pushed the left
            column taller than the right, so the supporting figures bottom-
            aligned to a sentence instead of to the numeral they qualify. */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
          <Figure className="hero-figure" value={bookings} format={n0} />
          {target > 0 && <span className="hero-of">/ {n0(target)}</span>}
        </div>

        <div className="hero-stats">
          {stats.map(s => (
            <div key={s.label} className="hero-stat">
              <div className="hero-stat-label">{s.label}</div>
              <div className="hero-stat-value" style={{ color: s.tone }}>{s.node}</div>
            </div>
          ))}
        </div>
      </div>

      {target > 0 && (
        <>
          {/* A rule, not a pill. In a running month the tick marks where the
              bookings should stand by now, so the gap between the end of the
              bar and the tick is the pace, readable without a number. */}
          <div className="hero-meter">
            <div className="hero-meter-fill" style={{ width: `${fill}%`, background: meter }} />
            {pacing && (
              <div className="hero-meter-tick"
                   style={{ left: `${(100 * month.days) / month.total}%` }}
                   aria-hidden="true" />
            )}
          </div>
          <div className="hero-scale">
            <span>0</span>
            <span>Target {n0(target)}</span>
          </div>
        </>
      )}
    </div>
  );
}
