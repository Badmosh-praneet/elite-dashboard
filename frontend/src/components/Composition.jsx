/**
 * The month as shares rather than counts.
 *
 * Everything on this panel answers "of the whole, how much is X". That is the
 * one question a ring answers better than a bar, which is why these are the
 * only rings on the sheet - and why the cuts drawn here were picked for having
 * few enough categories to read at a glance. The order book sits in four
 * states, the dealership sells four model families. Colour has twelve, so its
 * tail is folded into Other by the endpoint rather than drawn as twelve
 * unreadable slivers.
 *
 * Two splits are deliberately not rings. Fresh against punched cars, and one
 * team against the other, are single numbers with a complement - a ring for a
 * two-way split is a worse bar. They are drawn as one bar each.
 *
 * The weekday chart is not a share at all. It is here because it answers the
 * question the shares provoke: enquiries arrive midweek and bookings close at
 * the weekend, which is a rostering fact rather than a sales one.
 */

import React, { useEffect, useState } from 'react';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip as RechartsTooltip, Legend,
} from 'recharts';
import { api, n0 } from '../api/client';

const AXIS = { fill: 'var(--ink-muted)', fontSize: 12 };

/* Same ordinal ramp the stacks use, so a model is the same colour wherever it
   appears on the sheet. "Other" stays the quietest thing in the ring. */
const RAMP = ['var(--o1)', 'var(--o2)', 'var(--o3)', 'var(--o4)', 'var(--o5)',
              'var(--viz-2)'];
const colourFor = (name, i) =>
  (name === 'Other' || name === 'Unspecified' ? 'var(--ink-muted)' : RAMP[i % RAMP.length]);

function Tip({ active, payload, total }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0];
  const value = Number(p.value) || 0;
  const share = total ? Math.round((1000 * value) / total) / 10 : null;
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--grid)',
      padding: '10px 14px', borderRadius: 'var(--radius-sm)',
      boxShadow: 'var(--shadow-md)', color: 'var(--ink)', fontSize: 12,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{p.name}</div>
      <div style={{ color: 'var(--ink-2)' }}>
        {n0(value)}{share != null && <> &middot; {share}%</>}
      </div>
    </div>
  );
}

function BarTip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--grid)',
      padding: '10px 14px', borderRadius: 'var(--radius-sm)',
      boxShadow: 'var(--shadow-md)', color: 'var(--ink)', fontSize: 12,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{label}</div>
      {payload.map((s, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, lineHeight: 1.7 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%',
                         background: s.color || s.fill, flexShrink: 0 }} />
          <span style={{ color: 'var(--ink-2)' }}>{s.name}</span>
          <b style={{ marginLeft: 'auto' }}>{n0(s.value)}</b>
        </div>
      ))}
    </div>
  );
}

/** A ring with its total in the middle, because the share is only half the answer. */
function Donut({ title, note, data, unit }) {
  const total = (data || []).reduce((a, d) => a + d.value, 0);
  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{ marginBottom: 10 }}>
        <h2>{title}</h2>
        <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{note}</span>
      </div>
      <div style={{ height: 240, width: '100%', position: 'relative' }}>
        {!data || !data.length ? (
          <div style={{ display: 'flex', height: '100%', alignItems: 'center',
                        justifyContent: 'center', color: 'var(--ink-muted)', fontSize: 13 }}>
            Nothing recorded yet.
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name"
                     innerRadius="56%" outerRadius="80%" paddingAngle={1}
                     stroke="var(--surface)" strokeWidth={2}>
                  {data.map((d, i) => (
                    <Cell key={d.name} fill={colourFor(d.name, i)} />
                  ))}
                </Pie>
                <RechartsTooltip content={p => <Tip {...p} total={total} />} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'var(--ink-muted)' }}
                        iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
            {/* Centred on the ring, not on the panel - the legend sits below and
                would drag a flex-centred label off the hole. */}
            <div style={{
              position: 'absolute', top: '42%', left: 0, right: 0,
              transform: 'translateY(-50%)', textAlign: 'center',
              pointerEvents: 'none',
            }}>
              <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.03em',
                            color: 'var(--ink)', lineHeight: 1 }}>
                {n0(total)}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--ink-muted)',
                            textTransform: 'uppercase', letterSpacing: '0.08em',
                            marginTop: 3 }}>
                {unit}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** A two-way split is a single bar. A ring for two slices is a worse bar. */
function Split({ label, data }) {
  const total = (data || []).reduce((a, d) => a + d.value, 0);
  if (!total) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 11, textTransform: 'uppercase',
                       letterSpacing: '0.08em', color: 'var(--ink-muted)' }}>
          {label}
        </span>
      </div>
      <div style={{ display: 'flex', height: 10, overflow: 'hidden' }}>
        {data.map((d, i) => (
          <div key={d.name} title={`${d.name}: ${d.value}`}
               style={{ width: `${(100 * d.value) / total}%`,
                        background: colourFor(d.name, i) }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 7, flexWrap: 'wrap' }}>
        {data.map((d, i) => (
          <span key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 6,
                                      fontSize: 12, color: 'var(--ink-2)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%',
                           background: colourFor(d.name, i) }} />
            {d.name}
            <b style={{ color: 'var(--ink)' }}>{n0(d.value)}</b>
            <span style={{ color: 'var(--ink-muted)' }}>
              {Math.round((100 * d.value) / total)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Composition({ refreshKey }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let dead = false;
    setError(null);
    api('/api/composition')
      .then(res => { if (!dead) setData(res); })
      .catch(e => { if (!dead) setError(e.message); });
    return () => { dead = true; };
  }, [refreshKey]);

  if (error) {
    return (
      <section style={{ marginBottom: 26 }}>
        <div className="panel">
          <div style={{ color: 'var(--critical)', fontSize: 13 }}>{error}</div>
        </div>
      </section>
    );
  }

  const peakEnq = (data?.weekday || []).reduce(
    (a, d) => (d.enquiries > (a?.enquiries ?? -1) ? d : a), null);
  const peakBook = (data?.weekday || []).reduce(
    (a, d) => (d.bookings > (a?.bookings ?? -1) ? d : a), null);

  return (
    <section style={{ marginBottom: 26 }}>
      <div className="panel-header" style={{ marginBottom: 14 }}>
        <h2>How the month splits</h2>
        <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
          {!data ? 'Reading the month…'
            : `${data.period} — every ring totals the ${n0(
                (data.order_book || []).reduce((a, d) => a + d.value, 0))} bookings`}
        </span>
      </div>

      <div style={{
        display: 'grid', gap: 20, marginBottom: 20,
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      }}>
        <Donut title="Where the order book stands"
               note="Every booking, by fulfilment state"
               data={data?.order_book} unit="bookings" />
        <Donut title="What is selling"
               note="Bookings by model family"
               data={data?.by_model} unit="bookings" />
        <Donut title="Colours customers choose"
               note="Bookings by colour, rarest folded into Other"
               data={data?.by_colour} unit="bookings" />
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-header" style={{ marginBottom: 16 }}>
            <h2>Two-way splits</h2>
            <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
              Where the car came from, and who sold it
            </span>
          </div>
          <Split label="Car origin" data={data?.by_origin} />
          <Split label="Team" data={data?.by_team} />
        </div>

        <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="panel-header" style={{ marginBottom: 14 }}>
            <h2>Which days are busy</h2>
            <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
              {peakEnq && peakBook
                ? `Enquiries peak ${peakEnq.day} (${n0(peakEnq.enquiries)}), `
                  + `bookings ${peakBook.day} (${n0(peakBook.bookings)})`
                : 'Enquiries and bookings by day of the week'}
            </span>
          </div>
          <div style={{ height: 232, width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              {/* Two scales an order of magnitude apart, so bookings get the
                  right-hand axis - otherwise they are a flat line on the floor
                  under the enquiry bars. */}
              <BarChart data={data?.weekday || []}
                        margin={{ top: 6, right: 4, left: -18, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={AXIS} dy={8} />
                <YAxis yAxisId="e" axisLine={false} tickLine={false} tick={AXIS} />
                <YAxis yAxisId="b" orientation="right" axisLine={false}
                       tickLine={false} tick={AXIS} />
                <RechartsTooltip content={BarTip}
                                 cursor={{ fill: 'var(--grid)', opacity: 0.35 }} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'var(--ink-muted)', paddingTop: 8 }}
                        iconType="circle" />
                <Bar yAxisId="e" dataKey="enquiries" name="Enquiries"
                     fill="var(--viz-1)" radius={[3, 3, 0, 0]} />
                <Bar yAxisId="b" dataKey="bookings" name="Bookings"
                     fill="var(--viz-2)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </section>
  );
}
