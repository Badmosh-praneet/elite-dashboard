/**
 * What the agent said on the phone.
 *
 * Perfox answers the calls and the dashboard reports the month, and until now
 * those were two systems to open. Nobody on the floor was going to check the
 * second one to find out what a customer had been told that morning, so the
 * call log lives here, next to the bookings it produces.
 *
 * A row per call, newest first, with the agent's own summary - which is the
 * part a sales manager actually reads. Opening a call fetches its recordings
 * at that moment rather than with the list: the URLs Perfox issues are
 * presigned and last fifteen minutes, so any fetched up front would be dead
 * before most people scrolled to them.
 *
 * `direction` is not shown. Every call on record reports "unknown", so a
 * column of it would be a column of nothing.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Phone, Globe, Play, ChevronDown, AlertTriangle } from 'lucide-react';
import { api, n0 } from '../api/client';

/* The combined leg is both halves of the conversation mixed, which is what
   someone checking a call wants; the single legs are there for when you need
   to hear one side clearly. Ordered so the useful one is first. */
const LEG_ORDER = ['combined', 'caller', 'ai'];
const LEG_LABEL = { combined: 'Full call', caller: 'Customer', ai: 'Agent' };

function mmss(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '—';
  return d.toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
    hour12: true,
  });
}

/* A phone call and a call from the website are different things to a manager -
   one is a lead who found the number, the other is a lead already on the site. */
function ChannelMark({ channel }) {
  const web = channel === 'web_voice';
  const Icon = web ? Globe : Phone;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                   color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>
      <Icon size={12} style={{ flex: 'none', color: 'var(--ink-muted)' }} />
      {web ? 'Web' : 'Phone'}
    </span>
  );
}

function Recordings({ callId }) {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let dead = false;
    setState({ loading: true });
    api(`/api/calls/${callId}/recordings`)
      .then(r => { if (!dead) setState({ loading: false, data: r }); })
      .catch(e => { if (!dead) setState({ loading: false, error: e.message }); });
    return () => { dead = true; };
  }, [callId]);

  if (state.loading) {
    return <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Fetching the recording…</div>;
  }
  if (state.error) {
    return (
      <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start',
                    fontSize: 12, color: 'var(--critical)' }}>
        <AlertTriangle size={13} style={{ flex: 'none', marginTop: 1 }} />
        <span>{state.error}</span>
      </div>
    );
  }

  const recs = [...(state.data?.recordings || [])].sort(
    (a, b) => LEG_ORDER.indexOf(a.leg) - LEG_ORDER.indexOf(b.leg));

  if (!recs.length) {
    return <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>No recording was kept for this call.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {recs.map(r => (
        <div key={r.leg} style={{ display: 'flex', alignItems: 'center', gap: 12,
                                  flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, textTransform: 'uppercase',
                         letterSpacing: '0.07em', color: 'var(--ink-muted)',
                         minWidth: 66 }}>
            {LEG_LABEL[r.leg] || r.leg}
          </span>
          {/* preload="none" deliberately: three legs across an open call would
              otherwise pull several megabytes of audio nobody asked to hear. */}
          <audio controls preload="none" src={r.url}
                 style={{ height: 34, flex: '1 1 260px', minWidth: 0 }} />
        </div>
      ))}
      {state.data?.expires_in_seconds != null && (
        <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
          These links are issued for {Math.round(state.data.expires_in_seconds / 60)} minutes.
          Reopen the call if playback stops working.
        </div>
      )}
    </div>
  );
}

export default function AgentCalls() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let dead = false;
    api('/api/calls')
      .then(r => { if (!dead) setData(r); })
      .catch(e => { if (!dead) setError(e.message); });
    return () => { dead = true; };
  }, []);

  const calls = data?.calls || [];
  const shown = useMemo(
    () => (showAll ? calls : calls.slice(0, 8)), [calls, showAll]);

  const note = !data && !error ? 'Reading the call log…'
    : error ? null
    : `${n0(data.total)} calls · ${mmss(data.talk_seconds)} on the phone`
      + ` · ${n0(data.recorded)} recorded`;

  return (
    <section style={{ marginBottom: 26 }}>
      <div className="panel">
        <div className="panel-header" style={{ marginBottom: 14 }}>
          <h2>Calls the agent handled</h2>
          <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{note}</span>
        </div>

        {error ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start',
                        fontSize: 13, color: 'var(--critical)', padding: '10px 0' }}>
            <AlertTriangle size={14} style={{ flex: 'none', marginTop: 2 }} />
            <span>{error}</span>
          </div>
        ) : !data ? (
          <div style={{ fontSize: 13, color: 'var(--ink-muted)', padding: '10px 0' }}>
            Reading the call log…
          </div>
        ) : !calls.length ? (
          <div style={{ fontSize: 13, color: 'var(--ink-muted)', padding: '10px 0' }}>
            The agent has not taken any calls yet.
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 34 }} aria-label="Open" />
                    <th>When</th>
                    <th>Caller</th>
                    <th>Channel</th>
                    <th className="num">Length</th>
                    <th>What was said</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(c => {
                    const isOpen = open === c.id;
                    return (
                      <React.Fragment key={c.id}>
                        <tr
                          onClick={() => setOpen(isOpen ? null : c.id)}
                          style={{ cursor: 'pointer' }}
                          aria-expanded={isOpen}
                        >
                          <td style={{ textAlign: 'center', color: 'var(--ink-muted)' }}>
                            {c.has_recording
                              ? <Play size={12} style={{
                                  transform: isOpen ? 'rotate(90deg)' : 'none',
                                  transition: 'transform 140ms ease' }} />
                              : <ChevronDown size={12} style={{
                                  transform: isOpen ? 'rotate(180deg)' : 'none',
                                  transition: 'transform 140ms ease' }} />}
                          </td>
                          <td>{when(c.started_at)}</td>
                          <td style={{ whiteSpace: 'normal' }}>
                            <div>{c.name || 'Unknown caller'}</div>
                            {c.phone && (
                              <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                                {c.phone}
                              </div>
                            )}
                          </td>
                          <td><ChannelMark channel={c.channel} /></td>
                          <td className="num">{mmss(c.duration_seconds)}</td>
                          {/* The summary is the column people read, so it gets
                              the room the fixed columns do not need. */}
                          <td style={{ whiteSpace: 'normal', maxWidth: 460,
                                       color: 'var(--ink-2)' }}>
                            {c.summary
                              ? (isOpen ? c.summary
                                        : c.summary.length > 120
                                          ? c.summary.slice(0, 120) + '…'
                                          : c.summary)
                              : <span style={{ color: 'var(--ink-muted)' }}>No summary</span>}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td />
                            <td colSpan={5} style={{ whiteSpace: 'normal',
                                                     padding: '4px 0 16px' }}>
                              {c.has_recording
                                ? <Recordings callId={c.id} />
                                : <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                                    This call was not recorded.
                                  </span>}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {calls.length > 8 && (
              <button
                className="rail-quiet"
                onClick={() => setShowAll(s => !s)}
                style={{ marginTop: 12, padding: '5px 12px', fontSize: 12 }}
              >
                {showAll ? 'Show recent only' : `Show all ${n0(calls.length)} calls`}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
