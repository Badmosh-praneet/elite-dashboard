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
  Tooltip as RechartsTooltip, Legend, LineChart, Line, LabelList, Cell,
} from 'recharts';
import { n0, pct } from '../api/client';

/* ---- shared chart chrome ---- */

const AXIS = { fill: 'var(--ink-muted)', fontSize: 11 };
// Solid hairlines rather than dashes. A dashed grid is a second texture
// competing with the bars for attention; a continuous 1px rule reads as a
// measuring line and then disappears, which is all a gridline should do.
const GRID = { stroke: 'var(--grid)', strokeWidth: 1, vertical: false };
const LEGEND = {
  wrapperStyle: { fontSize: '12px', color: 'var(--ink-muted)', paddingTop: '10px' },
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
      listStyle: 'none', margin: 0, padding: '10px 0 0', fontSize: 12,
      color: 'var(--ink-muted)',
    }}>
      {items.map(it => (
        <li key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 9, height: 9, borderRadius: '50%',
            background: it.color, flexShrink: 0,
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
      boxShadow: 'var(--shadow-md)', color: 'var(--ink)', fontSize: '12px',
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
        {sub && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{sub}</span>}
      </div>
      <div style={{ height, width: '100%' }}>
        {empty ? (
          <div style={{
            display: 'flex', height: '100%', alignItems: 'center',
            justifyContent: 'center', color: 'var(--ink-muted)', fontSize: 13,
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

function BookingPace({ orderbook = [], target = 0 }) {
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

/* ---- 2. Commitment vs achievement, by window of the month ---- */

const WINDOW_ORDER = ['TILL 12TH', '13 TO 19', '20 TO 26', '27 TO 31'];

function Commitments({ commitments = [] }) {
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

  return (
    <Panel
      title="Commitment vs Achievement"
      sub="Consultant booking commitments by window of the month"
      empty={!data.length}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 16, right: 10, left: -20, bottom: 0 }}
                  barGap={2} barSize={34}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="window" axisLine={false} tickLine={false} tick={AXIS} dy={8} />
          <YAxis axisLine={false} tickLine={false} tick={AXIS} />
          <RechartsTooltip content={props => <Tip {...props} />}
                           cursor={{ fill: 'var(--grid)', opacity: 0.4 }} />
          {/* Same reason as the ageing ramp: Recharts sorts the key
              alphabetically, so it read "Achieved, Committed" while the bars
              drew committed first. */}
          <Legend
            {...LEGEND}
            content={<OrderedLegend items={[
              { label: 'Committed', color: 'var(--viz-1)' },
              { label: 'Achieved', color: 'var(--viz-2)' },
            ]} />}
          />
          <Bar dataKey="Committed" fill="var(--viz-1)" radius={[3, 3, 0, 0]}>
            <LabelList dataKey="Committed" position="top"
                       style={{ fill: 'var(--ink-muted)', fontSize: 11 }} />
          </Bar>
          <Bar dataKey="Achieved" fill="var(--viz-2)" radius={[3, 3, 0, 0]}>
            <LabelList dataKey="Achieved" position="top"
                       style={{ fill: 'var(--ink-muted)', fontSize: 11 }} />
          </Bar>
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

function StockAgeing({ ageing = [] }) {
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

/* ---- 4. Backorders: who has waited longest, and is there a car for them ---- */

function Backorders({ backorders = [] }) {
  // The panel used to plot all 21 rows, but ten of them are carry-over from
  // earlier months sitting at ~500 days. They set the scale, so this month's
  // orders - the ones anyone can still act on - were drawn as stubs, and the
  // count disagreed with the Backorders tile, which counts the current period
  // only. Current month leads; the rest is stated, not plotted.
  const current = backorders.filter(b => b.is_current_period);
  const carried = backorders.filter(b => !b.is_current_period);

  const data = [...current]
    .sort((a, b) => num(b.days_waiting) - num(a.days_waiting))
    .slice(0, 10)
    .map(b => ({
      who: b.customer_name || 'Unknown',
      model: b.model_family || b.model || '',
      Waiting: num(b.days_waiting),
      matched: num(b.matching_free_units) > 0,
    }));

  const matchedCount = current.filter(b => num(b.matching_free_units) > 0).length;
  const sub = [
    `${current.length} waiting this month`,
    matchedCount ? `${matchedCount} already has a matching free car` : null,
    carried.length ? `${carried.length} carried over from earlier months` : null,
  ].filter(Boolean).join(' · ');

  return (
    <Panel
      title="Backorders Awaiting Stock"
      sub={sub}
      empty={!data.length}
      height={340}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical"
                  margin={{ top: 4, right: 52, left: 4, bottom: 0 }} barSize={18}>
          <CartesianGrid stroke="var(--grid)" strokeWidth={1} horizontal={false} />
          <XAxis type="number" axisLine={false} tickLine={false} tick={AXIS}
                 tickFormatter={v => `${v}d`} />
          <YAxis type="category" dataKey="who" width={132} axisLine={false}
                 tickLine={false} tick={{ ...AXIS, fontSize: 11 }} interval={0} />
          <RechartsTooltip
            content={props => {
              const p = props.payload && props.payload[0];
              return (
                <Tip
                  {...props}
                  suffix=" days"
                  title={p ? `${p.payload.who} · ${p.payload.model}` : props.label}
                />
              );
            }}
            cursor={{ fill: 'var(--grid)', opacity: 0.4 }}
          />
          <Bar dataKey="Waiting" name="Days waiting" radius={[0, 3, 3, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.matched ? 'var(--warning)' : 'var(--viz-1)'} />
            ))}
            <LabelList
              dataKey="Waiting"
              position="right"
              formatter={v => `${v}d`}
              style={{ fill: 'var(--ink-muted)', fontSize: 11 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  );
}

/* ---- 5. Consultant conversion ---- */

function ConsultantConversion({ scorecards = [] }) {
  const data = scorecards
    .filter(s => s.row_kind === 'CONSULTANT' && num(s.total_leads) > 0)
    .map(s => ({
      consultant: s.consultant || '—',
      'Test drive %': Number(num(s.td_conv_pct).toFixed(1)),
      'Booking %': Number(num(s.booking_conv_pct).toFixed(1)),
    }))
    .sort((a, b) => b['Booking %'] - a['Booking %'])
    .slice(0, 9);

  return (
    <Panel
      title="Consultant Conversion"
      sub="Share of each consultant's own leads reaching test drive and booking"
      empty={!data.length}
      height={340}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical"
                  margin={{ top: 4, right: 44, left: 4, bottom: 0 }}
                  barGap={2} barSize={11}>
          <CartesianGrid stroke="var(--grid)" strokeWidth={1} horizontal={false} />
          <XAxis type="number" axisLine={false} tickLine={false} tick={AXIS}
                 tickFormatter={v => `${v}%`} />
          <YAxis type="category" dataKey="consultant" width={128} axisLine={false}
                 tickLine={false} tick={{ ...AXIS, fontSize: 11 }} interval={0} />
          <RechartsTooltip content={props => <Tip {...props} suffix="%" />}
                           cursor={{ fill: 'var(--grid)', opacity: 0.4 }} />
          <Legend
            {...LEGEND}
            content={<OrderedLegend items={[
              { label: 'Test drive %', color: 'var(--viz-1)' },
              { label: 'Booking %', color: 'var(--viz-2)' },
            ]} />}
          />
          <Bar dataKey="Test drive %" fill="var(--viz-1)" radius={[0, 3, 3, 0]} />
          <Bar dataKey="Booking %" fill="var(--viz-2)" radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  );
}

/* ---- 6. Attachment rates: ratios against a limit -> meters, not a chart ---- */

function Attachments({ attachments }) {
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
                <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{r.label}</span>
                <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--ink)', fontWeight: 700 }}>
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

const SEVERITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };

function DataQuality({ issues = [] }) {
  const order = { high: 0, medium: 1, low: 2 };
  const rows = [...issues].sort(
    (a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));

  return (
    <Panel
      title="Data Quality"
      sub="Where the workbook disagrees with itself, worst first"
      empty={!rows.length}
      height={340}
    >
      <div style={{ overflowY: 'auto', height: '100%', paddingRight: 4 }}>
        {rows.map((r, i) => {
          const sev = SEVERITY_LABEL[r.severity] ? r.severity : 'low';
          return (
            <div key={i} style={{
              padding: '10px 0',
              borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--grid)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 3 }}>
                <SeverityMark severity={sev} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                  {r.issue}
                </span>
                <span style={{
                  marginLeft: 'auto', fontSize: 11, color: 'var(--ink-muted)',
                  whiteSpace: 'nowrap',
                }}>
                  {SEVERITY_LABEL[sev]} · {n0(r.affected_rows)} rows
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1.5,
                            paddingLeft: 23 }}>
                {r.detail}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
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
