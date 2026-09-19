import React from 'react';
import { Filter, ArrowRight } from 'lucide-react';
import { n0, pct } from '../api/client';

export default function SalesFunnel({ funnel = {} }) {
  const stages = funnel.stages || [
    { stage: 'Enquiries', value: 367, target: 450 },
    { stage: 'Qualified', value: 361, target: null },
    { stage: 'Test drives', value: 128, target: 300 },
    { stage: 'Bookings', value: 42, target: 84 },
    { stage: 'Retails', value: 18, target: 66 },
  ];

  const maxVal = Math.max(1, ...stages.map(s => Math.max(s.value || 0, s.target || 0)));

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Sales Conversion Funnel</h2>
          <div style={{ fontSize: '12px', color: 'var(--ink-muted)', marginTop: '2px' }}>
            Customer progression from initial enquiry to final retail delivery
          </div>
        </div>
        <Filter size={18} style={{ color: 'var(--ink-muted)' }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '10px' }}>
        {stages.map((s, idx) => {
          const val = Number(s.value || 0);
          const tgt = s.target ? Number(s.target) : null;
          const pctOfMax = (val / maxVal) * 100;
          const tgtPct = tgt ? (tgt / maxVal) * 100 : null;

          // Conversion rate from previous step
          const prevVal = idx > 0 ? Number(stages[idx - 1].value || 0) : null;
          const convRate = prevVal && prevVal > 0 ? (val / prevVal) * 100 : null;

          return (
            <div key={s.stage}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '13px',
                marginBottom: '5px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontWeight: '600' }}>{s.stage}</span>
                  {convRate != null && (
                    <span style={{
                      fontSize: '11px',
                      color: 'var(--ink-muted)',
                      background: 'var(--surface-sub)',
                      padding: '2px 6px',
                      borderRadius: '4px',
                    }}>
                      {pct(convRate)} conv
                    </span>
                  )}
                </div>
                <div style={{ fontWeight: '700' }}>
                  <span>{n0(val)}</span>
                  {tgt != null && (
                    <span style={{ color: 'var(--ink-muted)', fontWeight: '400', fontSize: '12px', marginLeft: '4px' }}>
                      / {n0(tgt)}
                    </span>
                  )}
                </div>
              </div>

              {/* Progress bar container with target tick */}
              <div style={{
                height: '12px',
                background: 'var(--sunken)',
                borderRadius: '2px',
                position: 'relative',
                /* The target mark has to sit ON the bar's end, so the track
                   cannot clip it. */
                overflow: 'visible',
              }}>
                <div style={{
                  height: '100%',
                  width: `${Math.max(1.5, pctOfMax)}%`,
                  background: 'var(--viz-1)',
                  borderRadius: '2px',
                  transition: 'width 0.4s ease',
                }} />
                {tgtPct != null && (
                  /* A full-height rule in seal ink with a cap above it: the old
                     2px tick in --ink was the same weight as the bar's own edge
                     and read as part of the fill. */
                  <div
                    title={`Target: ${tgt}`}
                    style={{
                      position: 'absolute',
                      left: `${tgtPct}%`,
                      top: '-4px',
                      bottom: '-4px',
                      width: '2px',
                      background: 'var(--shu)',
                      zIndex: 2,
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
