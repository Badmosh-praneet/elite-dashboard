/**
 * The month as shares rather than counts.
 *
 * Everything on this panel answers "of the whole, how much is X". It used to
 * answer it with three rings, on the argument that a ring is the one shape that
 * says "share" better than a bar. The rings could not say it at all.
 *
 * Colour was dealt out by position in a list sorted largest-first, and the
 * first slot on the ramp is its palest. So the biggest slice in every ring was
 * the least visible thing in it - Virtus, the top seller at 48%, Candy White at
 * 31%, Allotted at 43%, all drawn in a blue a shade off the background - and
 * because Recharts sets legend text in the slice colour, the same three had the
 * three labels nobody could read. The paint chart coloured Carbon Steel Gray
 * red, because it happened to land on the sixth slot. None of it showed a
 * number: twenty Virtus against fourteen facelift Taiguns was a judgement of
 * two angles. And each ring printed "42 bookings" in its middle, under a
 * heading that already said so.
 *
 * So these are share bars, the same device the two-way splits below have
 * always used: a row per category with its count and its share written out,
 * and a bar scaled to the whole month so a glance still reads as a fraction.
 * Nothing needs a legend, because every label sits on its own row. The order
 * book is drawn in pipeline order, because it is a process; the rest largest
 * first. Paint gets a swatch of the actual paint - the one place on the sheet
 * where colour is the data rather than a code for it.
 *
 * Colour has twelve values, so its tail is folded into Other by the endpoint.
 *
 * The weekday chart is not a share at all. It is here because it answers the
 * question the shares provoke: enquiries arrive midweek and bookings close at
 * the weekend, which is a rostering fact rather than a sales one.
 */

import React, { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip as RechartsTooltip, Legend,
} from 'recharts';
import { api, n0 } from '../api/client';

const AXIS = { fill: 'var(--ink-muted)', fontSize: 'var(--fs-small)' };

/* The ordinal ramp, used now only by the two-way splits below. It is dealt by
   position, so it does not keep a category the same colour across charts - an
   earlier note here said it did. "Other" stays the quietest thing present. */
const RAMP = ['var(--o1)', 'var(--o2)', 'var(--o3)', 'var(--o4)', 'var(--o5)',
              'var(--viz-2)'];
const colourFor = (name, i) =>
  (name === 'Other' || name === 'Unspecified' ? 'var(--ink-muted)' : RAMP[i % RAMP.length]);

function BarTip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--grid)',
      padding: '10px 14px', borderRadius: 'var(--radius-sm)',
      boxShadow: 'var(--shadow-md)', color: 'var(--ink)', fontSize: 'var(--fs-small)',
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

/* Approximate paint for a colour name. Matched on the word that names the
   hue, so "Deep Black Pearl" and "Deep Black Pearlescent" land on the same
   swatch, and checked in order so Carbon Steel Gray is the dark grey before
   "gray" alone can claim it, and Lava Blue the deep blue before "blue". A name
   that matches nothing gets an empty ring rather than an invented colour. */
const PAINT = [
  [/white/i, '#f4f4f1'],
  [/black/i, '#17181b'],
  [/silver/i, '#b9bcc1'],
  [/carbon|graphite|charcoal/i, '#4b4f55'],
  [/gr[ae]y/i, '#83878d'],
  [/lava|lapiz|night|navy/i, '#1f3a6b'],
  [/blue/i, '#2f6cb2'],
  [/red|cherry|ruby|maroon/i, '#9d1c25'],
  [/yellow|curcuma|gold/i, '#dba427'],
  [/green|avocado|olive/i, '#667546'],
  [/orange|copper/i, '#c3622e'],
  [/brown|bronze|beige/i, '#7a5a3e'],
];
const paintFor = name => (PAINT.find(([re]) => re.test(name)) || [])[1] || null;

/* The endpoint sends model families in capitals. Everywhere else on the sheet
   they read as words - "Virtus", "Taigun (FL)" - so these do too; short and
   bracketed tokens are codes and keep their capitals. */
function label(name) {
  if (name !== name.toUpperCase()) return name;
  return name.split(/\s+/).map(w =>
    (w.length <= 3 || /[()\d]/.test(w)) ? w : w[0] + w.slice(1).toLowerCase(),
  ).join(' ');
}

/* A booking moves through these in order, so they are drawn in order. */
const PIPELINE = ['Booked', 'Awaiting stock', 'Allotted', 'Retailed'];
const byPipeline = rows => [...rows].sort((a, b) => {
  const ia = PIPELINE.indexOf(a.name), ib = PIPELINE.indexOf(b.name);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
});
/* Largest first, with Other last however large it is: it is the remainder,
   not a contender. */
const bySize = rows => [...rows].sort((a, b) => {
  const oa = a.name === 'Other', ob = b.name === 'Other';
  if (oa !== ob) return oa ? 1 : -1;
  return b.value - a.value;
});

/** One row per category: what it is, how many, what share - and a bar scaled to
    the whole month, so the fraction still reads at a glance. */
function ShareBars({ title, note, rows = [], swatches = false }) {
  const total = rows.reduce((a, d) => a + d.value, 0);
  return (
    <div className="panel">
      <div className="panel-header" style={{ marginBottom: 12 }}>
        <h2>{title}</h2>
        <span style={{ fontSize: 'var(--fs-small)', color: 'var(--ink-muted)' }}>{note}</span>
      </div>
      {!rows.length || !total ? (
        <div className="share-empty">Nothing recorded yet.</div>
      ) : (
        <div className="share-list">
          {rows.map(r => {
            const share = (100 * r.value) / total;
            const other = r.name === 'Other' || r.name === 'Unspecified';
            const paint = swatches && !other ? paintFor(r.name) : null;
            return (
              <div key={r.name} className="share-row"
                   data-other={other || undefined}
                   title={`${r.name}: ${n0(r.value)} of ${n0(total)} (${share.toFixed(1)}%)`}>
                <div className="share-line">
                  <span className="share-name">
                    {swatches && (
                      <span className="share-swatch" aria-hidden="true"
                            data-empty={paint ? undefined : true}
                            style={paint ? { background: paint } : undefined} />
                    )}
                    <span className="share-text">{label(r.name)}</span>
                  </span>
                  <span className="share-figs">
                    <b>{n0(r.value)}</b>
                    <span>{Math.round(share)}%</span>
                  </span>
                </div>
                <div className="share-track" aria-hidden="true">
                  <div style={{ width: `${Math.max(share, 1.5)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
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
        <span style={{ fontSize: 'var(--fs-small)', textTransform: 'uppercase',
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
                                      fontSize: 'var(--fs-small)', color: 'var(--ink-2)' }}>
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
          <div style={{ color: 'var(--critical)', fontSize: 'var(--fs-body)' }}>{error}</div>
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
        <span style={{ fontSize: 'var(--fs-small)', color: 'var(--ink-muted)' }}>
          {!data ? 'Reading the month…'
            : `${data.period} — each is a share of the month's ${n0(
                (data.order_book || []).reduce((a, d) => a + d.value, 0))} bookings`}
        </span>
      </div>

      <div style={{
        display: 'grid', gap: 20, marginBottom: 20,
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      }}>
        <ShareBars title="Where the order book stands"
                   note="Every booking, in the order it moves through"
                   rows={byPipeline(data?.order_book || [])} />
        <ShareBars title="What is selling"
                   note="Bookings by model family"
                   rows={bySize(data?.by_model || [])} />
        <ShareBars title="Colours customers choose"
                   note="Bookings by paint, rarest folded into Other"
                   rows={bySize(data?.by_colour || [])} swatches />
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-header" style={{ marginBottom: 16 }}>
            <h2>Two-way splits</h2>
            <span style={{ fontSize: 'var(--fs-small)', color: 'var(--ink-muted)' }}>
              Where the car came from, and who sold it
            </span>
          </div>
          <Split label="Car origin" data={data?.by_origin} />
          <Split label="Team" data={data?.by_team} />
        </div>

        <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="panel-header" style={{ marginBottom: 14 }}>
            <h2>Which days are busy</h2>
            <span style={{ fontSize: 'var(--fs-small)', color: 'var(--ink-muted)' }}>
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
                <Legend wrapperStyle={{ fontSize: 'var(--fs-small)', color: 'var(--ink-muted)', paddingTop: 8 }}
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
