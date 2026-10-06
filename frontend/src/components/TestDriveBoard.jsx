/**
 * Test drive board - PROTOTYPE.
 *
 * A day of demo-car test drives in thirty-minute slots, the requests the AI
 * agent has promised on calls, and the cars and team behind them.
 *
 * The agent already books test drives: seven calls in the log end with one,
 * and until now each promise lived only in that call's summary. The Agent
 * requests tab is where they surface, and Schedule puts one on the board with
 * the caller, their number, the car they asked about and a link back to the
 * call.
 *
 * The calendar also carries each day's enquiries and bookings - the rows
 * Sales over time plots, counted the same way - so a day reads as the day's
 * sales record, not only its test drives.
 *
 * What is real: the sales executives, the agent's requests, and the CRM's
 * enquiries, bookings and recorded drives (read, never written). What is not:
 * the demo cars (the database has none - these are placeholders in real model
 * families) and where bookings are kept (a file on this machine, not the
 * shared database). See app/test_drives.py.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { api, sendJson, money } from '../api/client';
import useClosing from './useClosing';

const BASE = '/api/test-drive-board';
const DAY = 86400000;

/* Dates are days, not instants: build and read them as UTC so no timezone
   can slide a booking onto the day before. */
const isoAdd = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const fmt = (iso, opts) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', ...opts });
const dayLong = iso => fmt(iso, { weekday: 'short', day: 'numeric', month: 'short' });
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const STATUS = {
  booked:    { label: 'Booked' },
  attended:  { label: 'Attended' },
  no_show:   { label: 'No-show' },
  cancelled: { label: 'Cancelled' },
  requested: { label: 'Requested' },
};

/* The agent says "for Friday", not a date. Turn the first weekday it names
   into the next such day on or after today; "tomorrow" into tomorrow. */
function dateFromHint(hint, today) {
  if (!hint) return null;
  const h = hint.toLowerCase();
  if (h === 'today') return today;
  if (h === 'tomorrow') return isoAdd(today, 1);
  const want = WEEKDAYS.indexOf(h);
  if (want < 0) return null;
  const now = new Date(`${today}T00:00:00Z`).getUTCDay();
  return isoAdd(today, (want - now + 7) % 7);
}

/* ---------------------------------------------------------------- dialogs */

function Dialog({ open, title, onClose, children, wide }) {
  const { render, leaving } = useClosing(open);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!render) return null;
  return (
    <div className={`drawer-scrim ${leaving ? 'is-leaving' : ''}`}
         style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="xp-panel tdb-dialog" role="dialog" aria-modal="true" aria-label={title}
           style={{ maxWidth: wide ? 560 : 480 }}>
        <div className="tdb-dialog-head">
          <h2>{title}</h2>
          <button type="button" className="rail-quiet" onClick={onClose} aria-label="Close">Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function BookingForm({ setup, bookings, draft, onCancel, onSaved }) {
  const [form, setForm] = useState(draft);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setForm(draft); setError(null); }, [draft]);

  // That day's drives, fetched for the day chosen, so a slot taken on a day
  // outside the month on screen is not offered as free.
  const [dayDrives, setDayDrives] = useState(null);
  useEffect(() => {
    let dead = false;
    setDayDrives(null);
    if (!form.date) return undefined;
    api(`${BASE}?start=${form.date}&days=1`)
      .then(r => { if (!dead) setDayDrives(r.bookings || []); })
      .catch(() => { if (!dead) setDayDrives(null); });
    return () => { dead = true; };
  }, [form.date]);

  // Only the slots still free on that car that day are offered.
  const taken = useMemo(() => new Set((dayDrives || bookings)
    .filter(b => b.car_id === form.car_id && b.date === form.date && b.start
                 && b.status !== 'cancelled' && b.id !== form.request_id)
    .map(b => b.start)), [dayDrives, bookings, form.car_id, form.date, form.request_id]);
  const free = setup.slots.filter(s => !taken.has(s));
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async e => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const row = await sendJson('POST', BASE, {
        car_id: form.car_id, date: form.date, start: form.start,
        customer: form.customer.trim(), phone: form.phone.trim(),
        consultant: form.consultant, location: form.location,
        address: form.location === 'Home' ? form.address.trim() : '',
        source: form.source, call_id: form.call_id || null,
        enquiry_id: form.enquiry_id || null,
        request_id: form.request_id || null,
      });
      onSaved(row);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="tdb-form" onSubmit={save}>
      {form.fromCall && (
        <div className="tdb-fromcall">
          <b>From a call on {fmt(form.fromCall.called_at.slice(0, 10), { day: 'numeric', month: 'short' })}</b>
          {form.fromCall.when_hint ? <> &middot; the agent noted &ldquo;{form.fromCall.when_hint}&rdquo;</> : null}
          <div>{form.fromCall.summary}</div>
        </div>
      )}
      {form.fromRequest && (
        <div className="tdb-fromcall">
          <b>Requested{form.fromRequest.source === 'AI agent' ? ' through the AI agent' : ''}
            {' '}on {fmt(form.fromRequest.created_at.slice(0, 10), { day: 'numeric', month: 'short' })}</b>
          {form.fromRequest.asked_time ? <> &middot; asked for {form.fromRequest.asked_time}</> : null}
          {form.fromRequest.note && <div>{form.fromRequest.note}</div>}
        </div>
      )}
      {form.fromEnquiry && (
        <div className="tdb-fromcall">
          <b>From an enquiry on {fmt(form.fromEnquiry.date, { day: 'numeric', month: 'short' })}</b>
          {[form.fromEnquiry.model && modelLabel(form.fromEnquiry.model), form.fromEnquiry.entered]
            .filter(Boolean).map(x => ` · ${x}`).join('')}
        </div>
      )}
      <div className="tdb-grid2">
        <label>Car
          <select value={form.car_id} onChange={e => set('car_id', e.target.value)}>
            {setup.cars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>Date
          <input type="date" value={form.date} min={setup.today}
                 onChange={e => set('date', e.target.value)} required />
        </label>
        <label>Time
          <select value={free.includes(form.start) ? form.start : ''}
                  onChange={e => set('start', e.target.value)} required>
            {!free.includes(form.start) && <option value="" disabled>Choose a free slot</option>}
            {free.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>Sales executive
          <select value={form.consultant} onChange={e => set('consultant', e.target.value)}>
            <option value="">Assign later</option>
            {setup.consultants.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label>Customer
          <input value={form.customer} onChange={e => set('customer', e.target.value)}
                 required maxLength={80} placeholder="Full name" />
        </label>
        <label>Phone
          <input value={form.phone} onChange={e => set('phone', e.target.value)}
                 maxLength={20} inputMode="tel" placeholder="Mobile number" />
        </label>
      </div>
      <fieldset className="tdb-choice">
        <legend>Where</legend>
        {['Showroom', 'Home'].map(v => (
          <label key={v}><input type="radio" name="loc" checked={form.location === v}
                                onChange={() => set('location', v)} /> {v === 'Home' ? 'At home' : 'Showroom'}</label>
        ))}
        {form.location === 'Home' && (
          <input className="tdb-address" value={form.address} onChange={e => set('address', e.target.value)}
                 maxLength={120} placeholder="Area or address" />
        )}
      </fieldset>
      <fieldset className="tdb-choice">
        <legend>Booked by</legend>
        {['Staff', 'Walk-in', 'AI agent'].map(v => (
          <label key={v}><input type="radio" name="src" checked={form.source === v}
                                onChange={() => set('source', v)} /> {v}</label>
        ))}
      </fieldset>
      {error && <div className="tdb-error" role="alert">{error}</div>}
      <div className="tdb-actions">
        <button type="button" className="rail-quiet" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={busy || !form.start || !form.customer.trim()}>
          {busy ? 'Booking…' : 'Book test drive'}
        </button>
      </div>
    </form>
  );
}

/* A test drive's details, with everything the agent noted. A request - filed
   by the database from an enquiry that did not say enough, or asked for a slot
   already taken - is scheduled from here. */
function BookingDetail({ booking, car, onClose, onChanged, onSchedule }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const requested = booking.status === 'requested';
  const change = async status => {
    setBusy(status); setError(null);
    try {
      const row = await sendJson('PATCH', `${BASE}/${booking.id}`, { status });
      onChanged(row);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };
  const when = requested
    ? `${booking.date ? dayLong(booking.date) : 'Day to confirm'} · ${booking.asked_time ? `asked for ${booking.asked_time}` : 'time to confirm'}`
    : `${dayLong(booking.date)} · ${booking.start}`;
  const from = booking.call_id ? ' · from a call' : booking.enquiry_id ? ' · from an enquiry' : '';
  return (
    <div className="tdb-detail">
      <dl>
        <dt>When</dt><dd>{when}</dd>
        <dt>Car</dt><dd>{car ? car.name : 'Model not recorded'}</dd>
        <dt>Customer</dt><dd>{booking.customer}{booking.phone ? ` · ${booking.phone}` : ''}</dd>
        <dt>Where</dt><dd>{booking.location === 'Home' ? `At home${booking.address ? `: ${booking.address}` : ''}` : 'Showroom'}</dd>
        <dt>Executive</dt><dd>{booking.consultant || 'Not assigned'}</dd>
        <dt>Booked by</dt><dd>{booking.source}{from}</dd>
        {booking.note && (
          <><dt>{booking.source === 'AI agent' ? 'Agent’s note' : 'Note'}</dt><dd className="tdb-notetext">{booking.note}</dd></>
        )}
        <dt>Status</dt><dd><span className="tdb-pill" data-status={booking.status}>{STATUS[booking.status]?.label}</span></dd>
      </dl>
      {error && <div className="tdb-error" role="alert">{error}</div>}
      <div className="tdb-actions">
        {requested ? (
          <>
            <button type="button" className="rail-quiet" disabled={!!busy} onClick={() => change('cancelled')}>
              {busy === 'cancelled' ? 'Cancelling…' : 'Cancel request'}
            </button>
            <button type="button" className="primary" onClick={() => onSchedule(booking)}>Schedule</button>
          </>
        ) : (
          <>
            {booking.status !== 'cancelled' && (
              <button type="button" className="rail-quiet" disabled={!!busy} onClick={() => change('cancelled')}>
                {busy === 'cancelled' ? 'Cancelling…' : 'Cancel booking'}
              </button>
            )}
            {booking.status !== 'no_show' && booking.status !== 'cancelled' && (
              <button type="button" disabled={!!busy} onClick={() => change('no_show')}>No-show</button>
            )}
            {booking.status !== 'attended' && booking.status !== 'cancelled' && (
              <button type="button" className="primary" disabled={!!busy} onClick={() => change('attended')}>
                Mark attended
              </button>
            )}
            {booking.status !== 'booked' && (
              <button type="button" disabled={!!busy} onClick={() => change('booked')}>Back to booked</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ board */

/* The month in view is held as its first day, YYYY-MM-01. */
const monthOf = iso => `${iso.slice(0, 7)}-01`;
const addMonths = (m, n) => {
  const d = new Date(`${m}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)).toISOString().slice(0, 10);
};
const daysIn = m => {
  const d = new Date(`${m}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
};
const monthName = m => fmt(m, { month: 'long', year: 'numeric' });
const shortDate = iso => fmt(iso, { day: 'numeric', month: 'short' });
/* Weeks run Monday to Sunday, as Sales over time's do. A month is loaded
   padded out to whole weeks, so the week view never shows a day it has not
   loaded - the first week of September starts on 31 August. */
const weekStart = iso => isoAdd(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7));
const rangeOf = m => {
  const start = weekStart(m);
  const end = isoAdd(weekStart(isoAdd(m, daysIn(m) - 1)), 7);          // exclusive
  return { start, days: Math.round((Date.parse(end) - Date.parse(start)) / DAY) };
};
/* Model families arrive in capitals ("TIGUAN R-LINE"); short and bracketed
   tokens are codes and keep theirs. */
const capWord = w => ((w.length <= 3 || /[()\d]/.test(w)) ? w.toUpperCase()
  : w[0].toUpperCase() + w.slice(1).toLowerCase());
const modelLabel = s => String(s || '').split(/\s+/).filter(Boolean)
  .map(w => w.split('-').map(capWord).join('-'))      // "R-LINE" -> "R-Line"
  .join(' ');

/* Workbook names arrive in capitals ("SUREKHA P") or all in lower case, and
   are set in title case; a name typed with its own capitals keeps them. */
const nameLabel = s => {
  const t = String(s || '').trim();
  if (t !== t.toUpperCase() && t !== t.toLowerCase()) return t;
  return t.toLowerCase().replace(/(^|[\s.'-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
};

/* A booking's state in the dashboard's words and tints - the Bookings
   table's (DataTables.jsx). ALLOTED is misspelled at source. */
const BOOKING_STATUS = {
  RETAILED:  { label: 'Retailed',  tint: 'var(--good)' },
  ALLOTED:   { label: 'Allotted',  tint: 'var(--viz-1)' },
  BOOKED:    { label: 'Booked',    tint: 'var(--ink-muted)' },
  NO_STOCK:  { label: 'No stock',  tint: 'var(--critical)' },
  CANCELLED: { label: 'Cancelled', tint: 'var(--ink-muted)' },
};

/* What a day can hold, the decisive first: bookings, test drives, enquiries.
   Bookings and enquiries take Sales over time's colours and its order, so the
   calendar and the chart read as one record - and a day's few bookings are
   never buried under its many enquiries. */
const KINDS = [
  { key: 'bookings',  one: 'booking',    many: 'bookings' },
  { key: 'drives',    one: 'test drive', many: 'test drives' },
  { key: 'enquiries', one: 'enquiry',    many: 'enquiries' },
];
const NONE = { enquiries: 0, drives: 0, bookings: 0, follow: 0 };   // follow: enquiries to follow up
const plural = (n, k) => `${n} ${n === 1 ? k.one : k.many}`;
const kindsIn = t => KINDS.filter(k => t[k.key] > 0);
const ENQUIRY_ROWS = 6;       // listed before "Show all"

/* One CRM record as a block in its car's All day lane: the same shape as a
   test drive in its slot, tinted by what it is rather than by status. */
const entrySub = (kind, item) => {
  if (kind === 'bookings') {
    return `Booking · ${(BOOKING_STATUS[item.status] || { label: item.status || 'status not recorded' }).label}`;
  }
  if (kind === 'drives') return `Test drive · ${item.status || 'recorded'}`;
  if (kind === 'requests') return `Requested · ${item.asked_time ? `asked ${item.asked_time}` : 'time to confirm'}`;
  // An enquiry says where it stands with its test drive, if it has or wants one.
  const td = item.test_drive;
  if (item.follow_up) {
    return !td ? 'Follow up · test drive'
      : td.status === 'requested' ? 'Follow up · time to confirm' : 'Follow up · no-show';
  }
  if (td && td.status === 'requested') return 'Test drive requested';
  if (td) {
    return td.status === 'attended' ? 'Test drive attended'
      : td.status === 'no_show' ? 'Test drive · no-show' : `Test drive · ${shortDate(td.date)}`;
  }
  return `Enquiry${item.channel ? ` · ${item.channel}` : ''}`;
};

function EntryBlock({ kind, item, onOpen }) {
  const who = nameLabel(item.name || item.customer);
  const sub = entrySub(kind, item);
  // A request is a test drive still owed a time: the drive's colour, the follow-up's amber.
  const state = kind === 'requests' || item.follow_up ? 'is-follow' : item.test_drive ? 'is-linked' : '';
  return (
    <button type="button" className={`tdb-entry ${state}`} data-kind={kind === 'requests' ? 'drives' : kind}
            onClick={() => onOpen({ kind, item })} title={`${who} · ${sub}`}>
      <b>{who}</b>
      <span>{sub}</span>
    </button>
  );
}

/* The same, as a pill on an enquiry's row in the agenda. */
function EnquiryState({ item }) {
  const td = item.test_drive;
  if (item.follow_up) {
    return (
      <span className="tdb-pill" data-status="no_show">
        {!td ? 'Follow up' : td.status === 'requested' ? 'Follow up · time to confirm' : 'Follow up · no-show'}
      </span>
    );
  }
  if (td && td.status === 'requested') return <span className="tdb-pill" data-status="requested">Test drive requested</span>;
  if (!td) return null;
  return (
    <span className="tdb-pill" data-status={td.status}>
      {td.status === 'attended' ? 'Test drive attended'
        : td.status === 'no_show' ? 'Test drive · no-show' : `Test drive · ${shortDate(td.date)}`}
    </span>
  );
}

const RECORD_TITLE = { bookings: 'Booking', drives: 'Recorded test drive', enquiries: 'Enquiry' };

/* What the CRM holds on one booking, enquiry or recorded drive. Read-only: the
   board never writes to the CRM. An enquiry can be turned into a test drive. */
function RecordDetail({ record, onBook, onOpenDrive, onScheduleRequest }) {
  const { kind, item } = record;
  const st = BOOKING_STATUS[item.status] || { label: item.status || 'Not recorded', tint: 'var(--ink-muted)' };
  const rows = [
    ['When', `${dayLong(item.date)} · time not recorded`],
    ['Car', [item.model ? modelLabel(item.model) : 'Model not recorded', item.variant].filter(Boolean).join(' · ')],
    ['Customer', [nameLabel(item.name || item.customer), item.phone].filter(Boolean).join(' · ')],
    ['Executive', item.consultant || 'Not assigned'],
  ];
  if (kind !== 'drives') rows.push(['Channel', item.channel || 'Not recorded']);
  if (kind === 'enquiries' && item.request) rows.push(['Asked for', item.request]);
  if (kind === 'enquiries') {
    const td = item.test_drive;
    rows.push(['Test drive', td
      ? (td.status === 'requested'
        ? `Requested${td.date ? ` for ${dayLong(td.date)}` : ''}${td.asked_time ? ` · asked ${td.asked_time}` : ''} · time to confirm`
        : `${dayLong(td.date)} · ${td.start} · ${STATUS[td.status]?.label || td.status}`)
      : item.wants_test_drive ? 'Asked for, not booked yet' : 'None booked']);
  }
  if (kind === 'bookings') rows.push(['Booking amount', item.amount ? money(item.amount) : 'Not recorded']);
  if (kind === 'drives' && item.km != null) rows.push(['Distance', `${item.km} km`]);
  rows.push(['Recorded via', item.entered || 'Not recorded']);
  return (
    <div className="tdb-detail">
      <dl>
        {rows.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}
        {kind === 'bookings' && (
          <><dt>Status</dt><dd><span className="tdb-state"><i style={{ background: st.tint }} />{st.label}</span></dd></>
        )}
        {kind === 'drives' && (
          <><dt>Status</dt><dd><span className="tdb-pill" data-status="attended">{item.status || 'Recorded'}</span></dd></>
        )}
      </dl>
      {/* The dialog's own Close sits in its header. What is left is what a
          test drive board can do for an enquiry: show its drive, or book one -
          again, when the first was missed. */}
      {kind === 'enquiries' && (
        <div className="tdb-actions">
          {item.test_drive && (
            <button type="button" onClick={() => onOpenDrive(item.test_drive)}>Open test drive</button>
          )}
          {(!item.test_drive || item.follow_up) && (
            <button type="button" className="primary"
                    onClick={() => (item.test_drive?.status === 'requested'
                      ? onScheduleRequest(item.test_drive) : onBook(item))}>
              {!item.test_drive ? 'Book a test drive' : item.test_drive.status === 'no_show' ? 'Book again' : 'Schedule'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* A day's counts as dots and numbers - in the strip, and in the week view's
   cells. Follow-ups are enquiries too, picked out in amber. */
function Marks({ t }) {
  const kinds = kindsIn(t);
  if (!kinds.length && !t.follow) return null;
  return (
    <span className="tdb-marks">
      {kinds.map(k => (
        <span key={k.key} className="tdb-mark"><i className="tdb-dot" data-kind={k.key} />{t[k.key]}</span>
      ))}
      {t.follow > 0 && (
        <span className="tdb-mark" title={`${t.follow} to follow up`}><i className="tdb-dot" data-kind="follow" />{t.follow}</span>
      )}
    </span>
  );
}
const describe = t => [...kindsIn(t).map(k => plural(t[k.key], k)),
  ...(t.follow ? [`${t.follow} to follow up`] : [])].join(', ') || 'nothing';

/* ---------------------------------------------------------------- search */

const RESULT_KIND = { bookings: 'Booking', enquiries: 'Enquiry', drives: 'Recorded drive', local: 'Test drive' };

/* Find a customer anywhere on the calendar. The server searches every month,
   so a name from August is found from October; picking one opens its day
   with the record on top. */
function SearchBox({ setup, onPick }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);       // null: nothing asked yet
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setResults(null); setOpen(false); return undefined; }
    let dead = false;
    const wait = setTimeout(() => {
      api(`${BASE}/search?q=${encodeURIComponent(t)}`)
        .then(r => { if (!dead) { setResults(r.results || []); setActive(0); setOpen(true); } })
        .catch(() => { if (!dead) { setResults([]); setOpen(true); } });
    }, 220);
    return () => { dead = true; clearTimeout(wait); };
  }, [q]);

  // A click anywhere else closes the list.
  useEffect(() => {
    if (!open) return undefined;
    const away = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const carName = id => setup.cars.find(c => c.id === id)?.name;
  const meta = ({ kind, item, date }) => [
    RESULT_KIND[kind],
    kind === 'local' ? carName(item.car_id) : (item.model ? modelLabel(item.model) : null),
    fmt(date || item.date, { day: 'numeric', month: 'short', year: 'numeric' })
      + (kind === 'local' ? (item.start ? ` · ${item.start}` : ' · requested') : ''),
  ].filter(Boolean).join(' · ');
  const choose = r => { setOpen(false); onPick(r); };
  const onKey = e => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!results || !results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(i => Math.min(i + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); choose(results[active]); }
  };

  return (
    <div className="tdb-search" ref={boxRef}>
      <Search size={14} aria-hidden="true" />
      <input type="search" value={q} placeholder="Search name or phone" role="combobox"
             aria-label="Search customers by name or phone" aria-expanded={open}
             aria-controls="tdb-search-results" aria-autocomplete="list"
             onChange={e => setQ(e.target.value)} onKeyDown={onKey}
             onFocus={() => { if (results) setOpen(true); }} />
      {open && results && (
        <div className="tdb-results" id="tdb-search-results" role="listbox" aria-label="Customers found">
          {results.length ? results.map((r, i) => (
            <button key={`${r.kind}-${r.item.id}`} type="button" role="option" aria-selected={i === active}
                    className={i === active ? 'is-active' : ''}
                    onMouseEnter={() => setActive(i)} onClick={() => choose(r)}>
              <i className="tdb-dot" data-kind={r.kind === 'local' ? 'drives' : r.kind} />
              <span className="tdb-res-name">{nameLabel(r.item.name || r.item.customer)}</span>
              <span className="tdb-res-meta">{meta(r)}</span>
            </button>
          )) : <div className="tdb-res-none">No customer matches &ldquo;{q.trim()}&rdquo;.</div>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ week */

/* The week at a glance: cars down the side, days across, each cell that day's
   count for that car, tinted deeper the busier it is. A click opens the day. */
function WeekView({ setup, day, vis, carOf, onDay, onJump }) {
  const start = weekStart(day);
  const days = Array.from({ length: 7 }, (_, i) => isoAdd(start, i));
  const inWeek = d => d >= days[0] && d <= days[6];
  const cell = {};
  const add = (car, d, k) => { const key = `${car}|${d}`; cell[key] = cell[key] || { ...NONE }; cell[key][k] += 1; };
  vis.bookings.filter(x => inWeek(x.date)).forEach(x => add(carOf(x), x.date, 'bookings'));
  [...vis.timed, ...vis.recorded, ...vis.requests].filter(x => inWeek(x.date)).forEach(x => add(carOf(x), x.date, 'drives'));
  vis.enquiries.filter(x => inWeek(x.date)).forEach(x => {
    add(carOf(x), x.date, 'enquiries');
    if (x.follow_up) add(carOf(x), x.date, 'follow');
  });
  const rows = setup.cars.map(c => ({ id: c.id, name: c.name, sub: c.summary }));
  if (days.some(d => cell[`null|${d}`])) rows.push({ id: null, name: 'Model not recorded', sub: '' });
  const at = (id, d) => cell[`${id}|${d}`] || NONE;
  const sum = list => list.reduce((a, t) => ({
    bookings: a.bookings + t.bookings, drives: a.drives + t.drives,
    enquiries: a.enquiries + t.enquiries, follow: a.follow + t.follow }), { ...NONE });
  const load = t => t.bookings + t.drives + t.enquiries;
  const max = Math.max(1, ...rows.flatMap(r => days.map(d => load(at(r.id, d)))));
  const today = setup.today;

  return (
    <div className="tdb-week">
      <div className="tdb-weekbar">
        <button type="button" className="tdb-nav" onClick={() => onJump(-7)} aria-label="Previous week">&#8249;</button>
        <b>{fmt(days[0], { day: 'numeric', month: 'short' })} &ndash; {fmt(days[6], { day: 'numeric', month: 'short', year: 'numeric' })}</b>
        <button type="button" className="tdb-nav" onClick={() => onJump(7)} aria-label="Next week">&#8250;</button>
        <span className="tdb-hint">Click a day to open it.</span>
      </div>
      <div className="tdb-weekwrap">
        <table className="tdb-weektable">
          <thead>
            <tr>
              <th scope="col" className="tdb-wcar">Car</th>
              {days.map(d => (
                <th key={d} scope="col" className={`${d === today ? 'is-today' : ''} ${d === day ? 'is-sel' : ''}`}>
                  <span>{d === today ? 'Today' : fmt(d, { weekday: 'short' })}</span>
                  <b>{fmt(d, { day: 'numeric' })}</b>
                </th>
              ))}
              <th scope="col" className="tdb-wsum">Week</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id || 'none'}>
                <th scope="row" className="tdb-wcar"><b>{r.name}</b>{r.sub && <span>{r.sub}</span>}</th>
                {days.map(d => {
                  const t = at(r.id, d);
                  const n = load(t);
                  return (
                    <td key={d} className={d === day ? 'is-sel' : ''}>
                      <button type="button" className="tdb-wcell" onClick={() => onDay(d)}
                              aria-label={`${r.name}, ${dayLong(d)}: ${describe(t)}`}
                              style={n ? { background: `color-mix(in srgb, var(--s1) ${Math.round(5 + (n / max) * 15)}%, var(--surface))` } : undefined}>
                        <Marks t={t} />
                      </button>
                    </td>
                  );
                })}
                <td className="tdb-wsum"><Marks t={sum(days.map(d => at(r.id, d)))} /></td>
              </tr>
            ))}
            <tr className="tdb-wtotal">
              <th scope="row" className="tdb-wcar"><b>All cars</b></th>
              {days.map(d => <td key={d}><Marks t={sum(rows.map(r => at(r.id, d)))} /></td>)}
              <td className="tdb-wsum"><Marks t={sum(rows.flatMap(r => days.map(d => at(r.id, d))))} /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- board */

/* A whole month, not a fortnight from today. The board used to show only the
   fourteen days from today, so August and September - where the dashboard's
   own month selector sits - could not be reached at all. Past days are
   history: they show what was booked and recorded, and their empty slots
   cannot be booked, because a test drive cannot be scheduled into the past.

   Each day also carries the enquiries and bookings Sales over time counts on
   it, so a day on the calendar is the day's whole sales record and not only
   its test drives. The month's totals switch each kind on and off, and an
   executive can be picked out; both narrow the strip, the day and the week
   alike. */
function Board({ setup, bookings, recorded, activity, month, setMonth, day, setDay, onSlot, onOpen,
                 onOpenRecord, onPick, view, setView, hidden, setHidden, exec, setExec, loading, loadError }) {
  const strip = useMemo(() => Array.from({ length: daysIn(month) }, (_, i) => isoAdd(month, i)), [month]);
  // In a slot: booked, done or missed. A request holds no slot; one that names
  // its day sits in the car's All day lane until someone gives it a time.
  const live = bookings.filter(b => b.status !== 'cancelled' && b.status !== 'requested');
  const asked = bookings.filter(b => b.status === 'requested' && b.date);
  const past = day < setup.today;
  const isThisMonth = month === monthOf(setup.today);
  const [expanded, setExpanded] = useState(null);     // the day whose enquiries are all listed

  /* The filters. A kind switched off leaves the strip, the lanes, the agenda
     and the week; an executive keeps only what is recorded against them. A
     test drive filtered out still holds its slot - dimmed, never free. */
  const known = new Set(setup.cars.map(c => c.id));
  const carOf = x => (known.has(x.car_id) ? x.car_id : null);
  const execOk = x => !exec || (x.consultant || '') === exec;
  const pass = (kind, x) => !hidden.includes(kind) && execOk(x);
  const vis = {
    bookings: activity.bookings.filter(x => pass('bookings', x)),
    timed: live.filter(x => pass('drives', x)),             // booked, in slots
    requests: asked.filter(x => pass('drives', x)),         // still owed a time
    recorded: recorded.filter(x => pass('drives', x)),      // the CRM's, all day
    enquiries: activity.enquiries.filter(x => pass('enquiries', x)),
  };

  // Every day's tally of what is showing, counted once.
  const tally = {};
  const add = (d, k) => { tally[d] = tally[d] || { ...NONE }; tally[d][k] += 1; };
  vis.bookings.forEach(x => add(x.date, 'bookings'));
  vis.timed.forEach(x => add(x.date, 'drives'));
  vis.recorded.forEach(x => add(x.date, 'drives'));
  vis.requests.forEach(x => add(x.date, 'drives'));
  vis.enquiries.forEach(x => { add(x.date, 'enquiries'); if (x.follow_up) add(x.date, 'follow'); });
  const dayT = tally[day] || NONE;

  // The month's totals answer to the executive, not to the kind switches -
  // a kind switched off still says how many it is hiding.
  const inMonth = x => x.date >= month && x.date < addMonths(month, 1);
  const monthTotals = {
    bookings: activity.bookings.filter(x => inMonth(x) && execOk(x)).length,
    drives: [...live, ...asked, ...recorded].filter(x => inMonth(x) && execOk(x)).length,
    enquiries: activity.enquiries.filter(x => inMonth(x) && execOk(x)).length,
    follow: activity.enquiries.filter(x => inMonth(x) && execOk(x) && x.follow_up).length,
  };
  const everything = [...activity.bookings, ...live, ...asked, ...recorded, ...activity.enquiries];
  const execs = [...new Set(everything.map(x => x.consultant).filter(Boolean).concat(exec ? [exec] : []))].sort();
  const noExec = exec ? everything.filter(x => inMonth(x) && !x.consultant).length : 0;
  const filtered = hidden.length > 0 || !!exec;
  const toggle = k => setHidden(h => (h.includes(k) ? h.filter(x => x !== k) : [...h, k]));

  const onDayAll = live.filter(b => b.date === day);                // every slot taken, shown or not
  const shownTimed = new Set(vis.timed.map(b => b.id));
  const timedOnDay = vis.timed.filter(b => b.date === day).sort((a, b) => a.start.localeCompare(b.start));
  const recOnDay = vis.recorded.filter(r => r.date === day);
  const reqOnDay = vis.requests.filter(r => r.date === day);
  const enqOnDay = vis.enquiries.filter(e => e.date === day);
  const bkOnDay = vis.bookings.filter(b => b.date === day);
  const at = (carId, slot) => onDayAll.find(b => b.car_id === carId && b.start === slot);
  const freeSlots = past ? 0 : setup.cars.length * setup.slots.length - onDayAll.length;
  const carById = id => setup.cars.find(c => c.id === id);

  /* Bookings, enquiries and recorded drives know their model but not their
     time, so each is a block in its car's All day lane, above the slots - as a
     calendar shows an all-day event - rather than in a slot it never had. One
     whose model was never recorded has no car to go on and gets a row of its
     own, so the grid still holds everything the day summary counts. */
  const laneFor = carId => [
    ...bkOnDay.filter(b => carOf(b) === carId).map(item => ({ kind: 'bookings', item })),
    ...recOnDay.filter(r => carOf(r) === carId).map(item => ({ kind: 'drives', item })),
    ...reqOnDay.filter(r => carOf(r) === carId).map(item => ({ kind: 'requests', item })),
    ...enqOnDay.filter(e => carOf(e) === carId).map(item => ({ kind: 'enquiries', item })),
  ];
  const unplaced = laneFor(null);

  /* The grid scrolls sideways on a narrow screen. A lane spans every slot
     column, so its blocks would wrap at the far edge and some would sit out
     of view; held to the visible width and pinned beside the car column,
     they stay in view however far the slots are scrolled. Measured again
     whenever the grid comes back from the week view. */
  const wrapRef = useRef(null);
  const [laneW, setLaneW] = useState(null);
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;
    const measure = () => {
      const corner = wrap.querySelector('.tdb-corner');
      setLaneW(wrap.clientWidth - (corner ? corner.offsetWidth : 0));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [view]);

  // Keep the chosen day in view inside the strip, without scrolling the page.
  const stripRef = useRef(null);
  useEffect(() => {
    const box = stripRef.current;
    const el = box && box.querySelector('[aria-selected="true"]');
    if (el) box.scrollLeft = el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2;
  }, [day, month]);

  const go = n => {
    const m = addMonths(month, n);
    setMonth(m);
    setDay(m === monthOf(setup.today) ? setup.today : m);
  };
  const goToday = () => { setMonth(monthOf(setup.today)); setDay(setup.today); };
  const jump = n => {                         // a week at a time, across months if need be
    const d = isoAdd(day, n);
    if (monthOf(d) !== month) setMonth(monthOf(d));
    setDay(d);
  };
  const openDay = d => { if (monthOf(d) !== month) setMonth(monthOf(d)); setDay(d); setView('day'); };
  const wk = view === 'week' ? weekStart(day) : null;

  // A drive recorded in the CRM is one that happened, so it counts as attended.
  const attended = timedOnDay.filter(b => b.status === 'attended').length
    + recOnDay.filter(r => /complet/i.test(r.status)).length;
  const noShows = timedOnDay.filter(b => b.status === 'no_show').length;

  const shownEnq = expanded === day ? enqOnDay : enqOnDay.slice(0, ENQUIRY_ROWS);
  const nothing = !enqOnDay.length && !timedOnDay.length && !recOnDay.length && !bkOnDay.length && !reqOnDay.length;
  const anything = onDayAll.length || asked.some(r => r.date === day) || recorded.some(r => r.date === day)
    || activity.enquiries.some(e => e.date === day) || activity.bookings.some(b => b.date === day);
  const lane = entries => (
    <div className="tdb-lane">
      <div className="tdb-lane-in">
        <span className="tdb-lane-tag">All day</span>
        {entries.map(({ kind, item }) => (
          <EntryBlock key={item.id} kind={kind} item={item}
                      onOpen={kind === 'requests' ? () => onOpen(item) : onOpenRecord} />
        ))}
      </div>
    </div>
  );

  return (
    <div className="tdb-board" aria-busy={loading}>
      <div className="tdb-monthbar">
        <button type="button" className="tdb-nav" onClick={() => go(-1)} aria-label="Previous month">&#8249;</button>
        <b className="tdb-month" aria-live="polite">{monthName(month)}</b>
        <button type="button" className="tdb-nav" onClick={() => go(1)} aria-label="Next month">&#8250;</button>
        {(!isThisMonth || day !== setup.today) && (
          <button type="button" className="rail-quiet tdb-today" onClick={goToday}>Today</button>
        )}
        {/* Until the month's own data has arrived the board does not claim
            the month is empty. Once it has, its totals are the key to the
            strip's dots and the switches for each kind. */}
        <div className={`tdb-monthsum ${loadError ? 'is-bad' : ''}`} title={loadError || undefined}>
          {loadError
            ? (loading ? 'This month could not be loaded' : 'Refresh failed · showing the last figures loaded')
            : loading ? 'Loading…'
            : (
              <>
                {KINDS.map(k => {
                  const on = !hidden.includes(k.key);
                  return (
                    <button key={k.key} type="button" className="tdb-kind" aria-pressed={on}
                            title={on ? `Hide ${k.many}` : `Show ${k.many}`} onClick={() => toggle(k.key)}>
                      <i className="tdb-dot" data-kind={k.key} />{plural(monthTotals[k.key], k)}
                    </button>
                  );
                })}
                {monthTotals.follow > 0 && (
                  <span className="tdb-follow-note"
                        title="Enquiries that asked for a test drive and have none booked, or missed it">
                    <i className="tdb-dot" data-kind="follow" />{monthTotals.follow} to follow up
                  </span>
                )}
              </>
            )}
        </div>
      </div>

      <div className="tdb-toolbar">
        <div className="tdb-seg" role="group" aria-label="View">
          {[['day', 'Day'], ['week', 'Week']].map(([k, label]) => (
            <button key={k} type="button" aria-pressed={view === k} className={view === k ? 'primary' : ''}
                    onClick={() => setView(k)}>{label}</button>
          ))}
        </div>
        <select className="tdb-exec" value={exec} onChange={e => setExec(e.target.value)} aria-label="Sales executive">
          <option value="">All executives</option>
          {execs.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        {filtered && (
          <button type="button" className="rail-quiet tdb-clear"
                  onClick={() => { setHidden([]); setExec(''); }}>Clear filters</button>
        )}
        {noExec > 0 && <span className="tdb-hint">{noExec} with no executive recorded are hidden</span>}
        <SearchBox setup={setup} onPick={onPick} />
      </div>

      <div className="tdb-strip" role="tablist" aria-label={`Days of ${monthName(month)}`} ref={stripRef}>
        {strip.map(d => {
          const t = tally[d] || NONE;
          const marks = kindsIn(t).length > 0 || t.follow > 0;
          return (
            <button key={d} type="button" role="tab" aria-selected={d === day}
                    aria-label={`${dayLong(d)}${marks ? `: ${describe(t)}` : ''}`}
                    className={`tdb-day ${d === day ? 'is-on' : ''} ${d < setup.today ? 'is-past' : ''} ${wk && d >= wk && d <= isoAdd(wk, 6) ? 'in-week' : ''}`}
                    onClick={() => setDay(d)}>
              <span className="tdb-dow">{d === setup.today ? 'Today' : fmt(d, { weekday: 'short' })}</span>
              <span className="tdb-dom">{fmt(d, { day: 'numeric' })}</span>
              {marks ? <Marks t={t} /> : <span className="tdb-mon">{fmt(d, { month: 'short' })}</span>}
            </button>
          );
        })}
      </div>

      {view === 'week' ? (
        <WeekView setup={setup} day={day} vis={vis} carOf={carOf} onDay={openDay} onJump={jump} />
      ) : (
        <>
          <div className="tdb-daysum">
            <b>{dayLong(day)}</b>
            {/* Test drives always, since the grid below is theirs; the rest when the day has any. */}
            {KINDS.filter(k => k.key === 'drives' || dayT[k.key] > 0).map(k => (
              <span key={k.key} className="tdb-tally">
                <i className="tdb-dot" data-kind={k.key} /><span><b>{dayT[k.key]}</b> {dayT[k.key] === 1 ? k.one : k.many}</span>
              </span>
            ))}
            {dayT.follow > 0 && (
              <span className="tdb-tally tdb-follow-note"><i className="tdb-dot" data-kind="follow" /><span><b>{dayT.follow}</b> to follow up</span></span>
            )}
            {dayT.drives > 0 && <span><b>{attended}</b> attended</span>}
            {dayT.drives > 0 && <span><b>{noShows}</b> {noShows === 1 ? 'no-show' : 'no-shows'}</span>}
            {past ? <span>Past day</span> : <span><b>{freeSlots}</b> free slots left</span>}
          </div>

          {/* A calendar grid scrolls sideways on a narrow screen, as calendars do;
              the car column stays pinned so a row never loses its name. A row is
              a model - one demo car each. */}
          <div className="tdb-gridwrap" ref={wrapRef} style={laneW ? { '--lane-w': `${laneW}px` } : undefined}>
            <div className="tdb-grid" style={{ '--slots': setup.slots.length }}>
              <div className="tdb-corner">Car</div>
              {setup.slots.map(s => <div key={s} className="tdb-time">{s}</div>)}
              {setup.cars.map(car => {
                const entries = laneFor(car.id);
                return (
                  <React.Fragment key={car.id}>
                    <div className={`tdb-car ${entries.length ? 'has-lane' : ''}`}>
                      <b>{car.name}</b>
                      <span>{car.summary}</span>
                    </div>
                    {entries.length > 0 && lane(entries)}
                    {setup.slots.map(s => {
                      const b = at(car.id, s);
                      if (b) {
                        return (
                          <button key={s} type="button" data-status={b.status}
                                  className={`tdb-slot tdb-block ${shownTimed.has(b.id) ? '' : 'is-dim'}`}
                                  onClick={() => onOpen(b)}
                                  title={`${b.customer} · ${s} · ${STATUS[b.status].label}`}>
                            <b>{b.customer}</b>
                            <span>{b.location === 'Home' ? 'Home' : 'Showroom'} &middot; {STATUS[b.status].label}</span>
                          </button>
                        );
                      }
                      return past
                        ? <div key={s} className="tdb-slot tdb-past" aria-hidden="true" />
                        : (
                          <button key={s} type="button" className="tdb-slot tdb-empty"
                                  onClick={() => onSlot(car.id, s)}
                                  aria-label={`Book ${car.name} at ${s}`} title={`Book ${car.name} at ${s}`} />
                        );
                    })}
                  </React.Fragment>
                );
              })}
              {unplaced.length > 0 && (
                <>
                  <div className="tdb-car tdb-car-none">
                    <b>Model not recorded</b>
                    <span>No car to place these on</span>
                  </div>
                  {lane(unplaced)}
                </>
              )}
            </div>
          </div>

          <div className="tdb-legend">
            {['booked', 'attended', 'no_show'].map(k => (
              <span key={k}><i className="tdb-swatch" data-status={k} /> {STATUS[k].label}</span>
            ))}
            <span className="tdb-hint">
              {past
                ? 'This day has passed, so its slots cannot be booked.'
                : `Click an empty slot to book. ${setup.slot_minutes}-minute slots, ${setup.slots[0]} to 19:00.`}
              {enqOnDay.length + bkOnDay.length + recOnDay.length + reqOnDay.length > 0
                && ' Bookings, enquiries and recorded drives carry a date but no time, so they sit in their car’s All day lane. Click one for its details.'}
            </span>
          </div>

          <h3 className="tdb-h3">Agenda &middot; {dayLong(day)}</h3>
          {nothing ? (
            <div className="tdb-empty-day">
              {loading ? 'Loading…'
                : anything ? 'Nothing on this day matches the filters.'
                : past ? 'Nothing was recorded on this day.'
                : 'Nothing booked yet. Click a slot above, or schedule one of the agent’s requests.'}
            </div>
          ) : (
            <>
              {bkOnDay.length > 0 && (
                <section className="tdb-group" aria-label="Bookings">
                  <h4 className="tdb-h4"><i className="tdb-dot" data-kind="bookings" />Bookings <span>{bkOnDay.length}</span></h4>
                  <div className="tdb-agenda">
                    {bkOnDay.map(b => {
                      const st = BOOKING_STATUS[b.status] || { label: b.status || 'Status not recorded', tint: 'var(--ink-muted)' };
                      return (
                        <div key={b.id} className="tdb-row tdb-line">
                          <div className="tdb-who">
                            <div><b>{nameLabel(b.customer)}</b>{b.model ? ` · ${modelLabel(b.model)}` : ''}</div>
                            <div className="tdb-meta">
                              {[b.variant, b.consultant,
                                b.amount ? `Booking amount ${money(b.amount)}` : '', b.channel, b.phone]
                                .filter(Boolean).join(' · ')}
                            </div>
                          </div>
                          <span className="tdb-state"><i style={{ background: st.tint }} />{st.label}</span>
                          <button type="button" className="rail-quiet" onClick={() => onOpenRecord({ kind: 'bookings', item: b })}>Open</button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {(timedOnDay.length > 0 || recOnDay.length > 0 || reqOnDay.length > 0) && (
                <section className="tdb-group" aria-label="Test drives">
                  <h4 className="tdb-h4"><i className="tdb-dot" data-kind="drives" />Test drives <span>{timedOnDay.length + recOnDay.length + reqOnDay.length}</span></h4>
                  <div className="tdb-agenda">
                    {timedOnDay.map(b => (
                      <div key={b.id} className="tdb-row">
                        <span className="tdb-at">{b.start}</span>
                        <div className="tdb-who">
                          <div><b>{b.customer}</b> &middot; {carById(b.car_id)?.name}</div>
                          <div className="tdb-meta">
                            {b.location === 'Home' ? `Home${b.address ? `: ${b.address}` : ''}` : 'Showroom'}
                            {b.phone ? ` · ${b.phone}` : ''}
                            {` · ${b.consultant || 'Executive not assigned'}`}
                            {` · ${b.source}`}
                          </div>
                        </div>
                        <span className="tdb-pill" data-status={b.status}>{STATUS[b.status].label}</span>
                        <button type="button" className="rail-quiet" onClick={() => onOpen(b)}>Open</button>
                      </div>
                    ))}
                    {/* Requests the database filed from an enquiry: a day, but no slot yet. */}
                    {reqOnDay.map(r => (
                      <div key={r.id} className="tdb-row tdb-rec">
                        <span className="tdb-at" title="No slot yet">{r.asked_time || '—'}</span>
                        <div className="tdb-who">
                          <div><b>{r.customer}</b>{carById(r.car_id) ? ` · ${carById(r.car_id).name}` : ''}</div>
                          <div className="tdb-meta">
                            {[r.location === 'Home' ? `Home${r.address ? `: ${r.address}` : ''}` : 'Showroom',
                              r.phone, r.source, r.asked_time ? `asked for ${r.asked_time}` : 'time to confirm']
                              .filter(Boolean).join(' · ')}
                          </div>
                        </div>
                        <span className="tdb-pill" data-status="no_show">Requested</span>
                        <button type="button" className="rail-quiet" onClick={() => onOpen(r)}>Open</button>
                      </div>
                    ))}
                    {/* Drives in the CRM's own record. They have a day but no time, so
                        they follow the timed bookings and say so plainly. */}
                    {recOnDay.map(r => (
                      <div key={r.id} className="tdb-row tdb-rec">
                        <span className="tdb-at" title="The CRM record has no time">&mdash;</span>
                        <div className="tdb-who">
                          <div><b>{nameLabel(r.customer)}</b>{r.model ? ` · ${modelLabel(r.model)}` : ''}</div>
                          <div className="tdb-meta">
                            {`Recorded in the CRM (${r.entered}) · time not recorded`}
                            {r.phone ? ` · ${r.phone}` : ''}
                            {r.consultant ? ` · ${r.consultant}` : ''}
                            {r.km != null ? ` · ${r.km} km` : ''}
                          </div>
                        </div>
                        <span className="tdb-pill" data-status="attended">{r.status || 'Recorded'}</span>
                        <button type="button" className="rail-quiet" onClick={() => onOpenRecord({ kind: 'drives', item: r })}>Open</button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {enqOnDay.length > 0 && (
                <section className="tdb-group" aria-label="Enquiries">
                  <h4 className="tdb-h4"><i className="tdb-dot" data-kind="enquiries" />Enquiries <span>{enqOnDay.length}</span></h4>
                  <div className="tdb-agenda">
                    {shownEnq.map(e => (
                      <div key={e.id} className="tdb-row tdb-line">
                        <div className="tdb-who">
                          <div><b>{nameLabel(e.name)}</b>{e.model ? ` · ${modelLabel(e.model)}` : ''}</div>
                          <div className="tdb-meta">
                            {[e.channel, e.by_agent && 'Via the AI agent', e.consultant, e.phone].filter(Boolean).join(' · ')
                              || 'Source not recorded'}
                          </div>
                        </div>
                        <EnquiryState item={e} />
                        <button type="button" className="rail-quiet" onClick={() => onOpenRecord({ kind: 'enquiries', item: e })}>Open</button>
                      </div>
                    ))}
                  </div>
                  {enqOnDay.length > ENQUIRY_ROWS && (
                    <button type="button" className="rail-quiet tdb-more"
                            onClick={() => setExpanded(expanded === day ? null : day)}>
                      {expanded === day ? 'Show fewer' : `Show all ${enqOnDay.length} enquiries`}
                    </button>
                  )}
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function Requests({ setup, requests, waiting, unavailable, onSchedule, onScheduleRequest, onOpenDrive }) {
  const carName = id => setup.cars.find(c => c.id === id)?.name;
  return (
    <>
      <h3 className="tdb-h3">Waiting for a time &middot; {waiting.length}</h3>
      <p className="tdb-lede">
        Test drives filed automatically from enquiries whose note did not say when - or asked for a
        slot already taken. Every one is already in the database; schedule it to give it a slot.
      </p>
      {waiting.length ? (
        <div className="tdb-agenda">
          {waiting.map(d => (
            <div key={d.id} className="tdb-row tdb-req">
              <span className="tdb-at">{fmt(d.created_at.slice(0, 10), { day: 'numeric', month: 'short' })}</span>
              <div className="tdb-who">
                <div>
                  <b>{d.customer}</b>
                  {d.phone ? ` · ${d.phone}` : ''}
                  {carName(d.car_id) ? ` · ${carName(d.car_id)}` : ' · car not named'}
                  {(d.date || d.asked_time) && (
                    <span className="tdb-hintchip">
                      asked for {[d.date && fmt(d.date, { weekday: 'short', day: 'numeric', month: 'short' }), d.asked_time].filter(Boolean).join(' ')}
                    </span>
                  )}
                </div>
                {d.note && <div className="tdb-meta tdb-summary">{d.note}</div>}
              </div>
              <button type="button" className="rail-quiet" onClick={() => onOpenDrive(d)}>Open</button>
              <button type="button" className="primary" onClick={() => onScheduleRequest(d)}>Schedule</button>
            </div>
          ))}
        </div>
      ) : <div className="tdb-empty-day">Nothing waiting: every test-drive enquiry has its slot.</div>}

      <h3 className="tdb-h3 tdb-h3-gap">From the call log &middot; {requests.length}</h3>
      <p className="tdb-lede">
        Calls where the AI agent offered or promised a test drive but no enquiry or drive was saved for
        the caller. Read live from the call log; the car is the one the caller asked about.
      </p>
      {unavailable ? <div className="tdb-empty-day">The call log cannot be read here: {unavailable}</div>
        : !requests.length ? <div className="tdb-empty-day">Every test drive promised on a call is on record.</div>
        : (
          <div className="tdb-agenda">
            {requests.map(r => (
              <div key={r.call_id} className="tdb-row tdb-req">
                <span className="tdb-at">{fmt((r.called_at || '').slice(0, 10), { day: 'numeric', month: 'short' })}</span>
                <div className="tdb-who">
                  <div>
                    <b>{r.name || 'Unknown caller'}</b>
                    {r.phone ? ` · ${r.phone}` : ''}
                    {carName(r.car_id) ? ` · ${carName(r.car_id)}` : ' · car not named'}
                    {r.when_hint ? <span className="tdb-hintchip">asked for {r.when_hint}</span> : null}
                  </div>
                  <div className="tdb-meta tdb-summary">{r.summary}</div>
                </div>
                <button type="button" className="primary" onClick={() => onSchedule(r)}>Schedule</button>
              </div>
            ))}
          </div>
        )}
    </>
  );
}

function FleetAndTeam({ setup }) {
  const models = setup.cars.reduce((n, c) => n + c.models.length, 0);
  const variants = setup.cars.reduce((n, c) => n + c.models.reduce((m, x) => m + x.variants.length, 0), 0);
  return (
    <>
      <section>
        <h3 className="tdb-h3">Cars &middot; {models} models, {variants} variants</h3>
        <p className="tdb-lede">
          The line-up as the catalogue holds it, busiest first. The database records stock but not
          which cars are demonstrators, so the board books one demo car per model; a customer can be
          shown any of its variants.
        </p>
        <div className="tdb-cars">
          {setup.cars.map(c => (
            <div key={c.id} className="tdb-carcard">
              <div className="tdb-carhead">
                <b>{c.name}</b>
                <span>{[c.summary || 'No variants listed', c.gearboxes.join(', ')].filter(Boolean).join(' · ')}</span>
              </div>
              {c.models.map(m => (
                <div key={m.name} className="tdb-model">
                  {c.models.length > 1 && (
                    <div className="tdb-modelname">{m.name} &middot; {m.variants.length} variants</div>
                  )}
                  {m.variants.length ? (
                    <ul className="tdb-variants">
                      {m.variants.map(v => (
                        <li key={v.id}><span>{v.name}</span>{v.gearbox && <em>{v.gearbox}</em>}</li>
                      ))}
                    </ul>
                  ) : <div className="tdb-meta">The catalogue lists no variants for this model yet.</div>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
      <section className="tdb-teamwrap">
        <h3 className="tdb-h3">Sales executives &middot; {setup.consultants.length}</h3>
        <p className="tdb-lede">Every active consultant in the database, offered when a drive is booked.</p>
        <div className="tdb-team">
          {setup.consultants.map(c => <span key={c}>{c}</span>)}
        </div>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------- page */

export default function TestDriveBoard({ refreshKey }) {
  const [setup, setSetup] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [recorded, setRecorded] = useState([]);
  const [activity, setActivity] = useState({ bookings: [], enquiries: [] });   // the CRM's, read-only
  const [requests, setRequests] = useState({ requests: [], waiting: [], unavailable: null });
  const [tab, setTab] = useState('board');
  const [month, setMonth] = useState(null);
  const [day, setDay] = useState(null);
  const [draft, setDraft] = useState(null);
  const [opened, setOpened] = useState(null);
  const [record, setRecord] = useState(null);         // a CRM booking, enquiry or recorded drive
  const lastRecord = useRef(null);                    // kept while its dialog closes
  const [error, setError] = useState(null);
  const [loadedFor, setLoadedFor] = useState(null);   // the month the data above belongs to
  const [monthError, setMonthError] = useState(null);
  const [view, setView] = useState('day');
  const [hidden, setHidden] = useState([]);            // kinds switched off in the month bar
  const [exec, setExec] = useState('');                // '' is every executive
  const [reloadTick, setReloadTick] = useState(0);     // a drive saved here: fetch its links again

  /* The request queue reads the live call log, which takes seconds, so it
     loads on its own and never holds up the board. */
  const refreshRequests = useCallback(() => api(`${BASE}/requests`)
    .then(r => setRequests({ requests: r.requests || [], waiting: r.waiting || [], unavailable: r.unavailable || null }))
    .catch(e => setRequests({ requests: [], waiting: [], unavailable: e.message })), []);
  // The waiting list is a quick read, so it follows every change the database
  // announces - a request the agent's enquiry filed appears without a reload.
  // The call log stays on its own, slower refresh above.
  useEffect(() => {
    let dead = false;
    api(`${BASE}/requests?calls=false`)
      .then(r => { if (!dead) setRequests(q => ({ ...q, waiting: r.waiting || [] })); })
      .catch(() => {});
    return () => { dead = true; };
  }, [refreshKey]);

  useEffect(() => {
    api(`${BASE}/setup`)
      .then(s => { setSetup(s); setMonth(monthOf(s.today)); setDay(s.today); })
      .catch(e => setError(e.message));
    refreshRequests();
  }, [refreshRequests]);

  /* The month in view: the board's own bookings, the drives in the CRM's
     record, and the CRM's enquiries and bookings. Fetched again whenever the
     month changes - and whenever the dashboard hears that the record changed,
     which is what refreshKey carries. A drive, booking or enquiry saved
     through the Record drawer or by the agent sends that signal, so it
     appears here without anyone reloading the page.

     The month is padded out to whole weeks (rangeOf), so the week view has
     every day it shows. A test drive saved or changed here refetches too, so
     the enquiry it was booked for shows it straight away.

     The short wait means paging quickly through months fetches only the one
     the board stops on, rather than queueing a pair of requests per month
     behind the dashboard's own. A failed refetch leaves the board as it was
     and says so in the month bar, rather than replacing it with an error. */
  useEffect(() => {
    if (!month) return undefined;
    let dead = false;
    const range = rangeOf(month);
    const span = `start=${range.start}&days=${range.days}`;
    const wait = setTimeout(() => {
      Promise.all([api(`${BASE}?${span}`), api(`${BASE}/recorded?${span}`), api(`${BASE}/activity?${span}`)])
        .then(([b, r, a]) => {
          if (dead) return;
          setBookings(b.bookings || []); setRecorded(r.recorded || []);
          setActivity({ bookings: a.bookings || [], enquiries: a.enquiries || [] });
          setLoadedFor(month); setMonthError(null);
        })
        .catch(e => { if (!dead) setMonthError(e.message); });
    }, 120);
    return () => { dead = true; clearTimeout(wait); };
  }, [month, refreshKey, reloadTick]);

  if (error) return <div className="panel"><div className="tdb-error">{error}</div></div>;
  if (!setup || !day || !month) return <div className="panel"><div className="tdb-empty-day">Opening the board…</div></div>;

  const blank = { customer: '', phone: '', consultant: '', location: 'Showroom', address: '', source: 'Staff',
                  call_id: null, fromCall: null, enquiry_id: null, fromEnquiry: null,
                  request_id: null, fromRequest: null };
  const firstFree = (carId, date) => setup.slots.find(s => !bookings.some(b =>
    b.car_id === carId && b.date === date && b.start === s && b.status !== 'cancelled')) || '';

  const bookSlot = (carId, start) => setDraft({ ...blank, car_id: carId, date: day, start });
  const schedule = r => {
    const carId = r.car_id || setup.cars[0].id;
    // Scheduling is forward-looking, so a request opens on today or later.
    const date = dateFromHint(r.when_hint, setup.today) || (day >= setup.today ? day : setup.today);
    setDraft({ ...blank, car_id: carId, date, start: firstFree(carId, date),
               customer: r.name || '', phone: r.phone || '', source: 'AI agent',
               call_id: r.call_id, fromCall: r });
  };
  const saved = row => {
    setBookings(b => [...b.filter(x => x.id !== row.id), row]);
    if (monthOf(row.date) !== month) setMonth(monthOf(row.date));   // follow it to its month
    setDay(row.date); setTab('board'); setDraft(null);
    refreshRequests();                  // a scheduled request leaves the queue
    setReloadTick(t => t + 1);          // and an enquiry booked from shows its drive
  };
  const changed = row => {
    setBookings(b => b.map(x => (x.id === row.id ? row : x)));
    setOpened(null);
    refreshRequests();                  // a cancelled one may come back to it
    setReloadTick(t => t + 1);          // as may an enquiry, to follow-up
  };
  // An enquiry becomes a test drive: the customer and the car they asked
  // about, on the first free slot from today.
  const bookFor = e => {
    const carId = setup.cars.some(c => c.id === e.car_id) ? e.car_id : setup.cars[0].id;
    const date = day >= setup.today ? day : setup.today;
    setRecord(null);
    setDraft({ ...blank, car_id: carId, date, start: firstFree(carId, date),
               customer: nameLabel(e.name), phone: e.phone || '', source: e.by_agent ? 'AI agent' : 'Staff',
               enquiry_id: e.id, fromEnquiry: e });
  };
  // A search result: its day, in the day view, with the record open on it.
  const pick = ({ kind, item, date }) => {
    const on = date || item.date;
    if (monthOf(on) !== month) setMonth(monthOf(on));
    setDay(on); setTab('board'); setView('day');
    if (kind === 'local') setOpened(item); else setRecord({ kind, item });
  };
  const openDrive = td => { setRecord(null); setOpened(td); };
  // A request becomes a booking: its car and day, the time the customer asked
  // for if that slot is free, and every detail the agent noted.
  const scheduleRequest = d => {
    const carId = setup.cars.some(c => c.id === d.car_id) ? d.car_id : setup.cars[0].id;
    const date = d.date && d.date >= setup.today ? d.date : (day >= setup.today ? day : setup.today);
    const askedFree = d.asked_time && setup.slots.includes(d.asked_time) && !bookings.some(b =>
      b.car_id === carId && b.date === date && b.start === d.asked_time && b.status !== 'cancelled');
    setOpened(null); setRecord(null); setTab('board');
    setDraft({ ...blank, car_id: carId, date, start: askedFree ? d.asked_time : firstFree(carId, date),
               customer: d.customer, phone: d.phone || '', consultant: d.consultant || '',
               location: d.location || 'Showroom', address: d.address || '', source: d.source || 'Staff',
               call_id: d.call_id, enquiry_id: d.enquiry_id, request_id: d.id, fromRequest: d });
  };
  if (record) lastRecord.current = record;
  const shown = record || lastRecord.current;

  return (
    <div className="panel tdb">
      <div className="tdb-top">
        <div className="tdb-eyebrow">Elite VW, Bengaluru &middot; Sales</div>
        <div className="tdb-tabs" role="tablist" aria-label="Test drive views">
          {[['board', 'Board'], ['requests', `Agent requests${requests.requests.length + requests.waiting.length ? ` · ${requests.requests.length + requests.waiting.length}` : ''}`], ['fleet', 'Cars and team']].map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k}
                    className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="tdb-note">
        Test drives are kept in the CRM database &middot; the ones customers agree with the AI agent are booked automatically from its notes &middot; enquiries, bookings and recorded drives are read live from the CRM &middot; one demo car per model is assumed
      </div>

      {tab === 'board' && <Board setup={setup} bookings={bookings} recorded={recorded} activity={activity}
                                 month={month} setMonth={setMonth} day={day} setDay={setDay}
                                 onSlot={bookSlot} onOpen={setOpened} onOpenRecord={setRecord} onPick={pick}
                                 view={view} setView={setView} hidden={hidden} setHidden={setHidden}
                                 exec={exec} setExec={setExec}
                                 loading={loadedFor !== month} loadError={monthError} />}
      {tab === 'requests' && <Requests setup={setup} {...requests} onSchedule={schedule}
                                       onScheduleRequest={scheduleRequest} onOpenDrive={setOpened} />}
      {tab === 'fleet' && <FleetAndTeam setup={setup} />}

      <Dialog open={!!draft} title="Book a test drive" onClose={() => setDraft(null)} wide>
        {draft && <BookingForm setup={setup} bookings={bookings} draft={draft}
                               onCancel={() => setDraft(null)}
                               onSaved={saved} />}
      </Dialog>
      <Dialog open={!!opened} title="Test drive" onClose={() => setOpened(null)}>
        {opened && <BookingDetail booking={opened} car={setup.cars.find(c => c.id === opened.car_id)}
                                  onClose={() => setOpened(null)} onChanged={changed}
                                  onSchedule={scheduleRequest} />}
      </Dialog>
      <Dialog open={!!record} title={shown ? RECORD_TITLE[shown.kind] : ''} onClose={() => setRecord(null)}>
        {shown && <RecordDetail record={shown} onBook={bookFor} onOpenDrive={openDrive}
                                onScheduleRequest={scheduleRequest} />}
      </Dialog>
    </div>
  );
}
