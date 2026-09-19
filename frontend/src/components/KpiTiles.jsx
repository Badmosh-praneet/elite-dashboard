/**
 * Headline tiles.
 *
 * A number on its own says nothing about whether it is good, so every tile
 * carries one piece of context and no more: a meter where a target exists, a
 * sparkline where an honest daily series exists, a share bar where the figure
 * is really a part of something. Nothing gets a decorative icon - the label
 * already says what it is.
 */

import React from 'react';
import { n0, money, pct } from '../api/client';

/* A sparkline, not a chart: no axes, no labels, just the shape of the month.
   Drawn as a path so it scales with the tile and recolours with the theme. */
function Spark({ series = [], color = 'var(--viz-1)' }) {
  if (series.length < 3) return null;
  const values = series.map(p => Number(p.n) || 0);
  const max = Math.max(...values, 1);
  const w = 100, h = 22;
  const step = w / (values.length - 1);
  const y = v => h - (v / max) * (h - 2) - 1;
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(2)} ${y(v).toFixed(2)}`).join(' ');
  const area = `${line} L${w} ${h} L0 ${h} Z`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: 22, display: 'block', overflow: 'visible' }}
      aria-hidden="true"
    >
      <path d={area} fill={color} opacity="0.11" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.4"
            strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* One rule, filled to the share. The track is the same ink at low alpha, so a
   full meter and an empty one read as the same object. */
function Meter({ share, color = 'var(--viz-1)' }) {
  const capped = Math.max(0, Math.min(100, share));
  return (
    <div style={{
      // The plot row is a flex container, so without an explicit width the
      // track shrinks to its (empty) content and renders as a stub.
      width: '100%',
      height: 5, background: 'var(--sunken)', borderRadius: 3,
      overflow: 'hidden', border: '0.5px solid var(--grid)',
    }}>
      <div style={{ width: `${capped}%`, height: '100%', background: color, borderRadius: 3 }} />
    </div>
  );
}

const num = v => (v == null ? 0 : Number(v));

export default function KpiTiles({ kpi = {}, trends = {} }) {
  const retails = num(kpi.retails);
  const retailTarget = num(kpi.retail_target);
  const enquiries = num(kpi.enquiries);
  const leadsTarget = num(kpi.leads_target);
  const testDrives = num(kpi.test_drives);
  const tdTarget = num(kpi.td_target);
  const free = num(kpi.free_stock);
  const allotted = num(kpi.allotted_stock);
  const onFloor = free + allotted;
  const over90 = num(kpi.stock_over_90_days);
  const bookings = num(kpi.bookings);
  const backorders = num(kpi.backorders);
  const pending = num(kpi.bookings_missing_crm_entry);

  const share = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);

  const tiles = [
    {
      label: 'Retails Delivered',
      value: n0(retails),
      share: share(retails, retailTarget),
      foot: `${pct(share(retails, retailTarget))} of ${n0(retailTarget)} target`,
    },
    {
      label: 'Total Enquiries',
      value: n0(enquiries),
      share: share(enquiries, leadsTarget),
      spark: trends.enquiries,
      foot: `${pct(share(enquiries, leadsTarget))} of ${n0(leadsTarget)} · ${n0(kpi.qualified)} qualified`,
    },
    {
      label: 'Test Drives',
      value: n0(testDrives),
      share: share(testDrives, tdTarget),
      foot: `${pct(share(testDrives, tdTarget))} of ${n0(tdTarget)} target`,
    },
    {
      label: 'Booking Revenue',
      value: money(kpi.booking_amount_collected),
      spark: trends.bookings,
      sparkColor: 'var(--viz-2)',
      foot: `Advance against ${n0(bookings)} bookings`,
    },
    {
      label: 'Free Stock',
      value: n0(free),
      share: share(free, onFloor),
      foot: `of ${n0(onFloor)} on the floor · ${n0(allotted)} allotted`,
    },
    {
      label: 'Ageing over 90 Days',
      value: n0(over90),
      share: share(over90, onFloor),
      color: 'var(--critical)',
      foot: `${pct(share(over90, onFloor))} of stock · carries interest`,
      tone: over90 > 0 ? 'alert' : 'normal',
    },
    {
      label: 'Backorders',
      value: n0(backorders),
      share: share(backorders, bookings),
      color: 'var(--warning)',
      foot: `${pct(share(backorders, bookings))} of bookings await a car`,
    },
    {
      label: 'Pending CRM Punch',
      value: n0(pending),
      share: share(pending, bookings),
      color: pending > 0 ? 'var(--critical)' : 'var(--good)',
      foot: `${pct(share(pending, bookings))} of bookings not in VW systems`,
      tone: pending > 0 ? 'alert' : 'normal',
    },
  ];

  return (
    <div className="grid-tiles">
      {tiles.map(t => (
        <div key={t.label} className="kpi-tile">
          <div className="label">{t.label}</div>
          <div className="val">{t.value}</div>
          <div className="kpi-plot">
            {t.spark
              ? <Spark series={t.spark} color={t.sparkColor || 'var(--viz-1)'} />
              : t.share != null
                ? <Meter share={t.share} color={t.color || 'var(--viz-1)'} />
                : null}
          </div>
          <div className={`sub ${t.tone === 'alert' ? 'alert' : ''}`}>{t.foot}</div>
        </div>
      ))}
    </div>
  );
}
