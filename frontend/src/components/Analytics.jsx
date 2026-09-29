/**
 * Analytics panels: the views the DSR database already supports but the
 * dashboard was not drawing - booking pace, commitment pacing, stock ageing,
 * backorder waiting time, consultant conversion, attachment rates and the
 * data-quality notes.
 *
 * Colour comes from the --viz-* tokens in index.css, which were validated with
 * the data-viz palette checker against this theme's real chart surfaces. Series
 * colour is never the only channel: every chart here carries a legend or a
 * direct label, and status is always icon + text as well as hue.
 */

import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  Tooltip as RechartsTooltip, Legend, LineChart, Line, LabelList,
} from 'recharts';
import { n0, pct } from '../api/client';

/* ---- shared chart chrome ---- */

const AXIS = { fill: 'var(--ink-muted)', fontSize: 'var(--fs-small)' };
// Solid hairlines rather than dashes. A dashed grid is a second texture
// competing with the bars for attention; a continuous 1px rule reads as a
// measuring line and then disappears, which is all a gridline should do.
const GRID = { stroke: 'var(--grid)', strokeWidth: 1, vertical: false };
const LEGEND = {
  wrapperStyle: { fontSize: 'var(--fs-small)', color: 'var(--ink-muted)', paddingTop: '10px' },
  iconType: 'circle',
};

/**
 * Legend rendered from an explicit list.
 *
 * Recharts orders its own legend by series name, which is fine for unordered
 * categories but scrambles an ordinal ramp - "180+" sorts between "0-30" and
 * "31-60", so the ageing bands read out of sequence. Passing `content` is the
 * only hook it does not re-derive.
 */
function OrderedLegend({ items }) {
  return (
    <ul style={{
      display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '4px 16px',
      listStyle: 'none', margin: 0, padding: '10px 0 0', fontSize: 'var(--fs-small)',
      color: 'var(--ink-muted)',
    }}>
      {items.map(it => (
        <li key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 9, height: 9, borderRadius: '50%',
            background: it.color, flexShrink: 0,
            // A series that is not a plain fill - the pale commitment target -
            // passes its own swatch so the key looks like the bar it names.
            ...(it.swatch || {}),
          }} />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/** One tooltip shape for every chart, so hover reads the same everywhere. */
function Tip({ active, payload, label, suffix = '', title }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--grid)',
      padding: '10px 14px', borderRadius: 'var(--radius-sm)',
      boxShadow: 'var(--shadow-md)', color: 'var(--ink)', fontSize: 'var(--fs-small)',
    }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{title || label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, lineHeight: 1.7 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: p.color || p.fill, flexShrink: 0,
          }} />
          <span style={{ color: 'var(--ink-2)' }}>{p.name}</span>
          <b style={{ marginLeft: 'auto', color: 'var(--ink)' }}>
            {n0(p.value)}{suffix}
          </b>
        </div>
      ))}
    </div>
  );
}

function Panel({ title, sub, children, empty, height = 300 }) {
  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{ marginBottom: 10 }}>
        <h2>{title}</h2>
        {sub && <span style={{ fontSize: 'var(--fs-small)', color: 'var(--ink-muted)' }}>{sub}</span>}
      </div>
      <div style={{ height, width: '100%' }}>
        {empty ? (
          <div style={{
            display: 'flex', height: '100%', alignItems: 'center',
            justifyContent: 'center', color: 'var(--ink-muted)', fontSize: 'var(--fs-body)',
          }}>
            No data available
          </div>
        ) : children}
      </div>
    </div>
  );
}

const num = v => (v == null ? 0 : Number(v));

/* ---- 1. Booking pace: cumulative actual against the linear target ---- */

export function BookingPace({ orderbook = [], target = 0 }) {
  const dated = orderbook
    .filter(b => b.booking_date && b.is_current_period !== false)
    .map(b => new Date(b.booking_date));

  let data = [];
  if (dated.length) {
    const any = dated[0];
    const year = any.getUTCFullYear(), month = any.getUTCMonth();
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const perDay = new Array(days + 1).fill(0);
    dated.forEach(d => {
      if (d.getUTCMonth() === month) perDay[d.getUTCDate()] += 1;
    });
    // Stop at the last day that has a booking. Running to the end of the month
    // drew the booked line flat along the floor for every day not yet
    // reported, which reads as sales having stopped rather than as days that
    // have not happened. The target pace is still computed against the whole
    // month, so the gap between the two lines still means "ahead" or "behind"
    // - it is only drawn as far as there is anything to compare it with.
    let lastDay = 0;
    for (let day = 1; day <= days; day++) if (perDay[day]) lastDay = day;

    let run = 0;
    for (let day = 1; day <= lastDay; day++) {
      run += perDay[day];
      data.push({
        day,
        Booked: run,
        'Target pace': Math.round((target * day) / days),
      });
    }
  }

  return (
    <Panel
      title="Booking Pace"
      sub="Cumulative bookings against an even target pace"
      empty={!data.length}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 16, left: -20, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="day" axisLine={false} tickLine={false} tick={AXIS} dy={8} />
          <YAxis axisLine={false} tickLine={false} tick={AXIS} />
          <RechartsTooltip
            content={props => <Tip {...props} title={`Day ${props.label}`} />}
            cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
          />
          <Legend
            {...LEGEND}
            content={<OrderedLegend items={[
              { label: 'Booked', color: 'var(--viz-1)' },
              { label: 'Target pace', color: 'var(--viz-2)' },
            ]} />}
          />
          <Line
            type="monotone" dataKey="Target pace" stroke="var(--viz-2)"
            strokeWidth={2} strokeDasharray="5 4" dot={false} />
          <Line
            type="monotone" dataKey="Booked" stroke="var(--viz-1)"
            strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </Panel>
  );
}

/* ---- 2. Commitment vs achievement: a target and what landed in it ---- */

const WINDOW_ORDER = ['TILL 12TH', '13 TO 19', '20 TO 26', '27 TO 31'];

/* The pair on the People page share one height, so they sit level. They used
   to be 300 and 340 - the commitments chart used the panel default and the
   conversion chart set its own. */
const PEOPLE_CHART_HEIGHT = 360;

/* The hover card, as a plain box, for the two charts below that need to say
   more than one series' value. Same look as Tip. */
const TIP_BOX = {
  background: 'var(--surface)', border: '1px solid var(--grid)',
  padding: '10px 14px', borderRadius: 'var(--radius-sm)',
  boxShadow: 'var(--shadow-md)', color: 'var(--ink)', fontSize: 'var(--fs-small)',
  lineHeight: 1.7,
};

/* "TILL 12TH" -> "Till 12th", "13 TO 19" -> "13-19" with an en dash. The
   workbook names its windows in capitals; everywhere else the sheet reads as
   sentences. */
const windowLabel = w => String(w || '')
  .replace(/^TILL\s+/i, 'Till ')
  .replace(/(\d+)\s+TO\s+(\d+)/i, '$1–$2')
  .replace(/(\d+)(ST|ND|RD|TH)\b/i, (_, n, s) => n + s.toLowerCase());

const ordinal = n => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'}`;
};

/* Each window's label, then what it delivered against what it promised -
   "24 of 36 · 67%" - so the comparison the bars make is also stated. */
function WindowTick({ x, y, payload, rows }) {
  const r = rows.find(d => d.window === payload.value);
  const rate = r && r.Committed > 0 ? Math.round((100 * r.Achieved) / r.Committed) : null;
  return (
    <g transform={`translate(${x},${y})`}>
      <text textAnchor="middle" dy={14} style={{ fill: 'var(--ink-2)', fontSize: 'var(--fs-small)' }}>
        {windowLabel(payload.value)}
      </text>
      {r && (
        <text textAnchor="middle" dy={30}
              style={{
                fill: rate != null && rate >= 100 ? 'var(--good-text)' : 'var(--ink-muted)',
                fontSize: 'var(--fs-small)',
                fontVariantNumeric: 'lining-nums tabular-nums',
              }}>
          {n0(r.Achieved)} of {n0(r.Committed)}{rate != null ? ` · ${rate}%` : ''}
        </text>
      )}
    </g>
  );
}

function CommitmentTip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const r = payload[0].payload;
  const rate = r.Committed > 0 ? Math.round((100 * r.Achieved) / r.Committed) : null;
  return (
    <div style={TIP_BOX}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{windowLabel(r.window)}</div>
      <div>Committed <b>{n0(r.Committed)}</b></div>
      <div>Achieved <b>{n0(r.Achieved)}</b>{rate != null ? ` · ${rate}%` : ''}</div>
    </div>
  );
}

export function Commitments({ commitments = [] }) {
  const byWindow = new Map();
  commitments.forEach(c => {
    const k = (c.window_label || '').toUpperCase();
    const row = byWindow.get(k) || { window: k, Committed: 0, Achieved: 0 };
    row.Committed += num(c.committed);
    row.Achieved += num(c.achieved);
    byWindow.set(k, row);
  });
  const data = [...byWindow.values()].sort((a, b) => {
    const ia = WINDOW_ORDER.indexOf(a.window), ib = WINDOW_ORDER.indexOf(b.window);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  const committed = data.reduce((a, d) => a + d.Committed, 0);
  const achieved = data.reduce((a, d) => a + d.Achieved, 0);
  /* The tracker is filled in by hand and August's stops at the 26th - the
     final window was never entered. Said once, so three windows are not read
     as the whole month. */
  const last = data.length ? data[data.length - 1].window : null;
  const partial = last && WINDOW_ORDER.indexOf(last) >= 0
    && WINDOW_ORDER.indexOf(last) < WINDOW_ORDER.length - 1;
  const endDay = partial ? Number((last.match(/(\d+)(?!.*\d)/) || [])[1]) : null;

  const sub = !data.length ? 'Consultant booking commitments by window of the month'
    : [
      `${n0(achieved)} of ${n0(committed)} committed bookings achieved`
        + (committed > 0 ? ` (${Math.round((100 * achieved) / committed)}%)` : ''),
      endDay ? `tracker runs to the ${ordinal(endDay)}` : null,
    ].filter(Boolean).join(' · ');

  return (
    <Panel title="Commitment vs Achievement" sub={sub}
           empty={!data.length} height={PEOPLE_CHART_HEIGHT}>
      <ResponsiveContainer width="100%" height="100%">
        {/* A target and what landed in it. The commitment is a pale bar and the
            achievement a narrower solid one drawn inside it, so a window that
            fell short leaves its target showing above, and one that beat it
            rises clear of the top. Two bars side by side asked the reader to
            compare two heights; this asks them to look at one. It also retires
            the red the achieved bars were drawn in, which made the window that
            beat its commitment by a third look like the worst of the three.

            Two x-axes on the same categories let the bars overlap rather than
            sit beside each other; the second is only a scale and is hidden. */}
        <BarChart data={data} margin={{ top: 12, right: 10, left: -18, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis xAxisId="target" dataKey="window" hide />
          <XAxis xAxisId="landed" dataKey="window" axisLine={false} tickLine={false}
                 interval={0} height={46} tick={<WindowTick rows={data} />} />
          {/* One gridline of headroom above the tallest bar, which otherwise sat
              exactly on the top edge and read as clipped. */}
          <YAxis axisLine={false} tickLine={false} tick={AXIS} allowDecimals={false}
                 domain={[0, max => Math.max(10, Math.ceil(max / 10) * 10 + 10)]} tickCount={6} />
          <RechartsTooltip content={<CommitmentTip />} cursor={{ fill: 'var(--grid)', opacity: 0.35 }} />
          <Legend
            {...LEGEND}
            content={<OrderedLegend items={[
              { label: 'Committed', swatch: { background: 'var(--sunken)', boxShadow: 'inset 0 0 0 1px var(--axis)' } },
              { label: 'Achieved', color: 'var(--viz-1)' },
            ]} />}
          />
          <Bar xAxisId="target" dataKey="Committed" name="Committed" barSize={52}
               fill="var(--sunken)" stroke="var(--axis)" strokeWidth={1}
               radius={[3, 3, 0, 0]} />
          <Bar xAxisId="landed" dataKey="Achieved" name="Achieved" barSize={24}
               fill="var(--viz-1)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  );
}

/* ---- 3. Stock ageing by model (ordered buckets -> one-hue ramp) ---- */

const BUCKETS = ['0-30', '31-60', '61-90', '91-180', '180+'];
const BUCKET_FILL = {
  '0-30': 'var(--viz-a1)', '31-60': 'var(--viz-a2)', '61-90': 'var(--viz-a3)',
  '91-180': 'var(--viz-a4)', '180+': 'var(--viz-a5)',
};

export function StockAgeing({ ageing = [] }) {
  // Recharts sorts the legend by dataKey, and the bucket labels sort
  // lexicographically - "180+" lands between "0-30" and "31-60", so the ordinal
  // ramp was listed out of sequence. Keying the rows by position instead makes
  // the sort order the ramp order; the readable label rides on the Bar's name.
  const slot = b => `b${BUCKETS.indexOf(b) + 1}`;

  const byModel = new Map();
  ageing.forEach(a => {
    const k = a.model || 'Unknown';
    if (BUCKETS.indexOf(a.ageing_bucket) < 0) return;
    const row = byModel.get(k) || { model: k };
    row[slot(a.ageing_bucket)] = num(a.units);
    byModel.set(k, row);
  });
  const data = [...byModel.values()].sort((a, b) => {
    const tot = r => BUCKETS.reduce((s, x) => s + (r[slot(x)] || 0), 0);
    return tot(b) - tot(a);
  });
  const present = BUCKETS.filter(b => data.some(r => r[slot(b)]));

  return (
    <Panel
      title="Stock Ageing by Model"
      sub="Units on the floor, banded by days since billing"
      empty={!data.length}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                  barSize={44}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="model" axisLine={false} tickLine={false} tick={AXIS} dy={8} />
          <YAxis axisLine={false} tickLine={false} tick={AXIS} />
          <RechartsTooltip content={props => <Tip {...props} suffix=" units" />}
                           cursor={{ fill: 'var(--grid)', opacity: 0.4 }} />
          <Legend
            {...LEGEND}
            content={<OrderedLegend items={present.map(b => ({
              label: `${b} days`, color: BUCKET_FILL[b],
            }))} />}
          />
          {present.map((b, i) => (
            <Bar
              key={b} dataKey={slot(b)} name={`${b} days`} stackId="age"
              fill={BUCKET_FILL[b]}
              // A hairline of the surface colour keeps the stacked segments from
              // reading as one block.
              stroke="var(--surface)" strokeWidth={1.5}
              radius={i === present.length - 1 ? [4, 4, 0, 0] : 0}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  );
}

/* ---- 4. Backorders: who can be delivered today, and who is still waiting ---- */

/* This used to be a bar chart of this month's ten longest waits, and it hid
   the most useful fact the data holds. Its subtitle said one order already had
   a matching free car. Four did - and the three it never drew were carry-over,
   two of them open for 514 days while their exact car, same variant and same
   colour, sat unallotted on the floor. Carry-over was left out of the plot
   because a 514-day bar crushes every 20-day bar beside it, which was true;
   but the fix for a scale problem cannot be to hide the orders that matter
   most.

   It was also the wrong shape for the question. A bar chart draws one thing,
   days, and a manager reading this panel is asking two others: who can I
   deliver today, and which car is each person waiting for. The model was only
   in the tooltip, so you learned it one hover at a time.

   So it is a worklist. Anything that can be filled from stock right now goes
   first, from any month, and is never collapsed away. This month's waits
   follow with a meter, so the comparison the chart made survives. Earlier
   months are a count until asked for. Every row names the car and the
   consultant, because a row that does not say who should act is a statistic.

   Customer mobile numbers are in the data and deliberately not on the row.
   This screen is demoed and screenshotted; the number belongs in the CRM. */

const cap = w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
const words = s => String(s || '').split(/\s+/).filter(Boolean);
/* Workbook names arrive in capitals; a worklist of them reads as shouting. */
const nameCase = s => words(s).map(cap).join(' ');
/* Trim codes are a mix of acronyms and words - DSG, AT, GT beside Topline and
   Sport - so short and numeric tokens keep their capitals and the rest do not,
   which is how Volkswagen writes them: "Virtus GT Line AT". */
const trimCase = s => words(s)
  .map(w => (/\d/.test(w) || w.length <= 3) ? w.toUpperCase() : cap(w))
  .join(' ');

/* Past a year an order is either a customer who has been badly let down or a
   row nobody closed. The sheet cannot tell which, so it says so and leaves the
   judgement to someone who can pick up the phone. */
const STALE_DAYS = 365;

/* Rows shown before "show all". Chosen so the default panel holds the height
   of Stock Ageing beside it and the grid pair stays level. Deliverable orders
   are never counted against this: if a month has more cars to hand over, the
   panel grows, because that is the one list here that must never be cut. */
const WAITING_PREVIEW = 3;

function OrderRow({ r, tone, scale }) {
  const car = [cap(r.model || ''), trimCase(r.variant)].filter(Boolean).join(' ');
  const stale = r.days >= STALE_DAYS;
  /* The full line lives in the hover title as well, because the car cell
     ellipsises on a narrow column and a clipped consultant name is the one
     thing on the row someone would need to read. */
  const hint = [
    [car, r.consultant].filter(Boolean).join(' · '),
    r.colour,
    stale ? 'Open for over a year - confirm the order is still live before calling.' : null,
  ].filter(Boolean).join(' · ');

  /* Four cells on one line: who, which car and who owns it, where it stands,
     and how long. The third cell changes meaning by group - a count on the
     floor when there is a car to hand over, a meter when there is only the
     wait to compare - so each row carries exactly one status, never two. */
  return (
    <div className="bo-row" data-tone={tone} title={hint || undefined}>
      <span className="bo-who">{nameCase(r.who)}</span>
      <span className="bo-car">
        {car || 'Model not recorded'}
        {r.consultant ? ` · ${r.consultant}` : ''}
      </span>
      <span className="bo-status">
        {tone === 'deliver' && <span className="bo-free">{n0(r.free)} on the floor</span>}
        {tone === 'wait' && scale > 0 && (
          <span className="bo-meter" aria-hidden="true">
            <span style={{ width: `${Math.max(3, (r.days / scale) * 100)}%` }} />
          </span>
        )}
      </span>
      <span className={`bo-days ${stale ? 'is-stale' : ''}`}>{n0(r.days)}d</span>
    </div>
  );
}

function OrderGroup({ label, count, children }) {
  return (
    <div className="bo-group">
      <div className="bo-label">
        <span>{label}</span>
        <span>{n0(count)}</span>
      </div>
      {children}
    </div>
  );
}

export function Backorders({ backorders = [] }) {
  const [open, setOpen] = React.useState(false);

  const rows = backorders.map((b, i) => ({
    key: b.booking_id ?? i,
    who: b.customer_name || 'Unknown customer',
    model: b.model_family || b.model || '',
    variant: b.variant || '',
    colour: b.colour || '',
    consultant: b.consultant || '',
    days: num(b.days_waiting),
    free: num(b.matching_free_units),
    current: !!b.is_current_period,
  }));

  const byWait = (a, b) => b.days - a.days;
  const deliverable = rows.filter(r => r.free > 0).sort(byWait);
  const waiting = rows.filter(r => r.free === 0 && r.current).sort(byWait);
  const earlier = rows.filter(r => r.free === 0 && !r.current).sort(byWait);

  // Period totals stay period totals, so this agrees with the Backorders tile,
  // which counts the current month only.
  const thisMonth = rows.filter(r => r.current).length;
  const fromEarlier = rows.length - thisMonth;

  const sub = [
    deliverable.length
      ? `${n0(deliverable.length)} can be delivered from stock today`
      : 'None can be filled from current stock',
    `${n0(thisMonth)} open this month`,
    fromEarlier ? `${n0(fromEarlier)} from earlier months` : null,
  ].filter(Boolean).join(' · ');

  const shownWaiting = open ? waiting : waiting.slice(0, WAITING_PREVIEW);
  const scale = Math.max(0, ...waiting.map(r => r.days));
  const hidden = rows.length - deliverable.length - shownWaiting.length;

  return (
    <Panel
      title="Backorders Awaiting Stock"
      sub={sub}
      empty={!rows.length}
      height={rows.length ? 'auto' : 340}
    >
      <div className="bo-list">
        {deliverable.length > 0 && (
          <OrderGroup label="Deliverable now" count={deliverable.length}>
            {deliverable.map(r => <OrderRow key={r.key} r={r} tone="deliver" />)}
          </OrderGroup>
        )}

        {waiting.length > 0 && (
          <OrderGroup label="Waiting on stock · this month" count={waiting.length}>
            {shownWaiting.map(r => <OrderRow key={r.key} r={r} tone="wait" scale={scale} />)}
          </OrderGroup>
        )}

        {open && earlier.length > 0 && (
          <OrderGroup label="Waiting on stock · earlier months" count={earlier.length}>
            {earlier.map(r => <OrderRow key={r.key} r={r} tone="old" />)}
          </OrderGroup>
        )}

        {(hidden > 0 || open) && (
          <button
            type="button"
            className="rail-quiet bo-more"
            aria-expanded={open}
            onClick={() => setOpen(o => !o)}
          >
            {open ? 'Show fewer' : `Show all ${n0(rows.length)} orders`}
          </button>
        )}
      </div>
    </Panel>
  );
}

/* ---- 5. Consultant conversion ---- */

/* The name, and under it how many leads the percentages are taken from. A
   rate from eight leads and a rate from sixty look identical as bars; the
   count is what tells them apart. */
function ConsultantTick({ x, y, payload, rows }) {
  const r = rows.find(d => d.consultant === payload.value);
  return (
    <g transform={`translate(${x},${y})`}>
      <text textAnchor="end" dx={-6} dy={-2} style={{ fill: 'var(--ink-2)', fontSize: 'var(--fs-small)' }}>
        {payload.value}
      </text>
      {r && (
        <text textAnchor="end" dx={-6} dy={12}
              style={{ fill: 'var(--ink-muted)', fontSize: 'var(--fs-micro)',
                       fontVariantNumeric: 'lining-nums tabular-nums' }}>
          {n0(r.leads)} {r.leads === 1 ? 'lead' : 'leads'}
        </text>
      )}
    </g>
  );
}

function ConversionTip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const r = payload[0].payload;
  return (
    <div style={TIP_BOX}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{r.consultant}</div>
      <div>{n0(r.leads)} leads</div>
      <div><b>{n0(r.bookings)}</b> booked &middot; {r['Booking %']}%</div>
      <div><b>{n0(r.testDrives)}</b> test driven &middot; {r['Test drive %']}%</div>
    </div>
  );
}

const pctLabel = v => `${Math.round(Number(v) || 0)}%`;

export function ConsultantConversion({ scorecards = [] }) {
  const data = scorecards
    .filter(s => s.row_kind === 'CONSULTANT' && num(s.total_leads) > 0)
    .map(s => ({
      consultant: s.consultant || '—',
      leads: num(s.total_leads),
      testDrives: num(s.td_achieved),
      bookings: num(s.booking_achieved),
      'Booking %': Number(num(s.booking_conv_pct).toFixed(1)),
      'Test drive %': Number(num(s.td_conv_pct).toFixed(1)),
    }))
    .sort((a, b) => b['Booking %'] - a['Booking %'] || b.leads - a.leads)
    .slice(0, 9);

  return (
    <Panel
      title="Consultant Conversion"
      sub="Share of each consultant's own leads that booked and that took a test drive, best booking rate first"
      empty={!data.length}
      height={PEOPLE_CHART_HEIGHT}
    >
      <ResponsiveContainer width="100%" height="100%">
        {/* Booking rate leads each pair and sets the order, so the chart reads
            as one ranking. It used to be sorted by booking rate while the
            longer test-drive bars, drawn first and darker, jumped about from
            row to row - so a sorted chart looked unsorted. Test drive is now
            the lighter, supporting tone, and every bar says its own value. */}
        <BarChart data={data} layout="vertical"
                  margin={{ top: 4, right: 40, left: 4, bottom: 0 }}
                  barGap={2} barSize={10}>
          <CartesianGrid stroke="var(--grid)" strokeWidth={1} horizontal={false} />
          <XAxis type="number" axisLine={false} tickLine={false} tick={AXIS}
                 tickFormatter={v => `${v}%`} />
          <YAxis type="category" dataKey="consultant" width={122} axisLine={false}
                 tickLine={false} interval={0} tick={<ConsultantTick rows={data} />} />
          <RechartsTooltip content={<ConversionTip />} cursor={{ fill: 'var(--grid)', opacity: 0.4 }} />
          <Legend
            {...LEGEND}
            content={<OrderedLegend items={[
              { label: 'Booked', color: 'var(--viz-2)' },
              { label: 'Test drive', color: 'var(--o3)' },
            ]} />}
          />
          {/* minPointSize gives a zero a sliver to stand on, so a consultant with
              no bookings shows "0%" rather than a gap that reads as no data. */}
          <Bar dataKey="Booking %" name="Booked" fill="var(--viz-2)" radius={[0, 3, 3, 0]}
               minPointSize={2}>
            <LabelList dataKey="Booking %" position="right" formatter={pctLabel}
                       style={{ fill: 'var(--ink)', fontSize: 'var(--fs-micro)', fontWeight: 600 }} />
          </Bar>
          <Bar dataKey="Test drive %" name="Test drive" fill="var(--o3)" radius={[0, 3, 3, 0]}
               minPointSize={2}>
            <LabelList dataKey="Test drive %" position="right" formatter={pctLabel}
                       style={{ fill: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  );
}

/* ---- 6. Attachment rates: ratios against a limit -> meters, not a chart ---- */

export function Attachments({ attachments }) {
  const a = attachments || {};
  const regs = num(a.registrations);
  const rows = [
    { label: 'Finance', value: num(a.financed) },
    { label: 'Insurance', value: num(a.insured) },
    { label: 'Extended warranty', value: num(a.extended_warranty) },
    { label: 'Service value package', value: num(a.service_value_package) },
    { label: 'Corporate', value: num(a.corporate) },
  ];

  return (
    <Panel
      title="Attachment Rates"
      sub={regs ? `Share of ${n0(regs)} retails carrying each product` : 'Share of retails'}
      empty={!regs}
      height={340}
    >
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center',
                    gap: 18, height: '100%', paddingRight: 4 }}>
        {rows.map(r => {
          const share = regs ? (r.value / regs) * 100 : 0;
          return (
            <div key={r.label}>
              <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 6 }}>
                <span style={{ fontSize: 'var(--fs-body)', color: 'var(--ink-2)' }}>{r.label}</span>
                <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-body)', color: 'var(--ink)', fontWeight: 700 }}>
                  {n0(r.value)}<span style={{ color: 'var(--ink-muted)', fontWeight: 400 }}>
                    {' '}/ {n0(regs)} · {pct(share)}
                  </span>
                </span>
              </div>
              {/* Meter: the filled arc against its own track, same hue. */}
              <div style={{ height: 8, borderRadius: 4, background: 'var(--sunken)', overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.min(share, 100)}%`, height: '100%',
                  borderRadius: 4, background: 'var(--viz-1)',
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/* ---- 7. Data quality: qualitative -> a list, with icon + label, not hue alone ---- */

/* Stroke marks on a 14px grid, drawn rather than typed: a dingbat glyph
   renders in whatever face the OS substitutes and never matches the page. */
function SeverityMark({ severity }) {
  const color = severity === 'high' ? 'var(--critical)'
    : severity === 'medium' ? 'var(--warning)' : 'var(--ink-muted)';
  const common = {
    width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none',
    stroke: color, strokeWidth: 1.4, strokeLinecap: 'round',
    strokeLinejoin: 'round', style: { flex: 'none' },
  };
  if (severity === 'high') {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M7 1.9 12.6 11.8H1.4z" />
        <path d="M7 5.9v2.4" />
        <path d="M7 10.1h.01" />
      </svg>
    );
  }
  if (severity === 'medium') {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M7 1.8 12.2 7 7 12.2 1.8 7z" />
      </svg>
    );
  }
  return (
    <svg {...common} aria-hidden="true">
      <circle cx="7" cy="7" r="4.6" />
    </svg>
  );
}

const SEVERITIES = [
  { key: 'high',   label: 'High priority' },
  { key: 'medium', label: 'Medium priority' },
  { key: 'low',    label: 'Low priority' },
];

/* "31 test drives", "1 consultant". The view says what each count is a count
   of; it used to print "rows" for everything, which is a spreadsheet's word,
   and "1 rows", which is nobody's. A count with no unit - the static fallback
   predates the column - is a count of records. */
function counted(n, unit) {
  const noun = unit || 'record';
  return `${n0(n)} ${n === 1 ? noun : `${noun}s`}`;
}

function IssueRow({ issue }) {
  const n = Number(issue.affected_rows) || 0;
  return (
    <div className="dq-row">
      <SeverityMark severity={issue.severity} />
      <div className="dq-body">
        <div className="dq-line">
          <span className="dq-title">{issue.issue}</span>
          <span className="dq-count">{counted(n, issue.unit)}</span>
        </div>
        <div className="dq-detail">{issue.detail}</div>
      </div>
    </div>
  );
}

/* Where the workbook disagrees with itself.

   It was a 340px box with its own scrollbar, holding eight issues that needed
   nearer five hundred - so two or three were always out of sight, the only
   low-priority one among them, and a reader who did not think to scroll inside
   a panel never learned they existed. It now shows everything it holds or says
   plainly what it is holding back. The high-priority issues are always open,
   because they are the ones to act on; the rest sit behind one line that names
   how many there are and of what kind, the same pattern as the backorders
   worklist. The header counts every level, so the whole picture is on the
   first screen whether or not anyone opens the rest. */
export function DataQuality({ issues = [] }) {
  const [open, setOpen] = React.useState(false);

  const known = new Set(SEVERITIES.map(s => s.key));
  const rows = issues.map(i => ({ ...i, severity: known.has(i.severity) ? i.severity : 'low' }));
  // Largest first within a level - the only order that needs no explaining.
  const byLevel = SEVERITIES.map(s => ({
    ...s,
    items: rows.filter(r => r.severity === s.key)
               .sort((a, b) => (Number(b.affected_rows) || 0) - (Number(a.affected_rows) || 0)),
  })).filter(g => g.items.length);

  const high = byLevel.filter(g => g.key === 'high');
  const rest = byLevel.filter(g => g.key !== 'high');
  const restCount = rest.reduce((a, g) => a + g.items.length, 0);
  // With nothing urgent there is nothing to hold back: show the lot.
  const showRest = open || !high.length;

  return (
    <div className="panel">
      <div className="dq-head">
        <div className="panel-header">
          <h2>Data Quality</h2>
          <span style={{ fontSize: 'var(--fs-small)', color: 'var(--ink-muted)' }}>
            Where the workbook disagrees with itself, most serious first
          </span>
        </div>
        {byLevel.length > 0 && (
          <div className="dq-summary" aria-label="Issues by priority">
            {byLevel.map(g => (
              <span key={g.key} className="dq-summary-item">
                <SeverityMark severity={g.key} />
                {n0(g.items.length)} {g.key}
              </span>
            ))}
          </div>
        )}
      </div>

      {!byLevel.length ? (
        <div className="dq-clear">The workbook agrees with itself - nothing to report.</div>
      ) : (
        <>
          {[...high, ...(showRest ? rest : [])].map(g => (
            <section key={g.key} className="dq-group">
              <div className="dq-group-label">
                <span>{g.label}</span>
                <span>{n0(g.items.length)}</span>
              </div>
              {g.items.map(i => <IssueRow key={i.issue} issue={i} />)}
            </section>
          ))}

          {high.length > 0 && restCount > 0 && (
            <button type="button" className="rail-quiet dq-more"
                    aria-expanded={open} onClick={() => setOpen(o => !o)}>
              {open
                ? 'Show high priority only'
                : `Show ${n0(restCount)} more · ${rest.map(g => `${n0(g.items.length)} ${g.key}`).join(', ')}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/* ---- layout ---- */

export default function Analytics({
  orderbook = [], commitments = [], ageing = [], backorders = [],
  scorecards = [], attachments = null, dataQuality = [], kpi = {},
}) {
  return (
    <>
      <div className="grid-2">
        <BookingPace orderbook={orderbook} target={num(kpi.booking_target)} />
        <Commitments commitments={commitments} />
      </div>
      <div className="grid-2">
        <StockAgeing ageing={ageing} />
        <ConsultantConversion scorecards={scorecards} />
      </div>
      <div className="grid-2">
        <Backorders backorders={backorders} />
        <Attachments attachments={attachments} />
      </div>
      <DataQuality issues={dataQuality} />
    </>
  );
}
