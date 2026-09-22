/**
 * The left rail.
 *
 * Everything that was competing for the top of the page - identity, the period
 * control, live state, the entry actions, the view toggles - now lives down the
 * side, where it stays put while the sheet scrolls past it. The page was 4,500
 * pixels tall with no way to get anywhere; the rail is also the map.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  PlusCircle, UserPlus, Compass, KeyRound, UploadCloud, Download,
  RefreshCw, Table, Sun, Moon, Headset, CalendarCog, ChevronDown
} from 'lucide-react';

const ENTRIES = [
  { tab: 'booking', label: 'New booking', Icon: PlusCircle },
  { tab: 'lead', label: 'New lead', Icon: UserPlus },
  { tab: 'testdrive', label: 'Test drive', Icon: Compass },
  { tab: 'allotment', label: 'Allotment', Icon: KeyRound },
];

const RECORD_OPEN_KEY = 'dsr.rail.record.open';

/** Whether the Record group was left open, remembered per browser. */
function rememberedOpen() {
  try {
    return window.localStorage.getItem(RECORD_OPEN_KEY) === '1';
  } catch {
    // Private windows and blocked site data both throw here. Closed is the
    // safe default: it is the state that saves the space.
    return false;
  }
}

export default function Rail({
  periods = [],
  activePeriod = '',
  onPeriodChange,
  liveStatus = { state: 'off', text: 'connecting' },
  sections = [],
  activeSection,
  onOpenDrawer,
  onOpenUpload,
  onOpenExport,
  onRefresh,
  isRefreshing,
  showTables,
  onToggleTables,
  onManagePeriods,
  theme,
  onToggleTheme,
}) {
  const [recordOpen, setRecordOpen] = useState(rememberedOpen);
  const recordRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(RECORD_OPEN_KEY, recordOpen ? '1' : '0');
    } catch {
      // Nothing to do - the group still works, it just will not be remembered.
    }
  }, [recordOpen]);

  const activeObj = periods.find(p => p.label === activePeriod) || {};
  const span = (() => {
    const { period_start: a, period_end: b } = activeObj;
    if (!a || !b) return null;
    const from = new Date(a), to = new Date(b);
    if (Number.isNaN(+from) || Number.isNaN(+to)) return null;
    return `${from.getUTCDate()}–${to.getUTCDate()} ${
      to.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`;
  })();

  return (
    <aside className="rail">
      <div className="rail-identity">
        <span className="rail-seal">VW</span>
        <div>
          <div className="rail-name">Volkswagen<br />Elite Motors</div>
          <div className="rail-place">Hosur Road, Bengaluru</div>
        </div>
      </div>
      


      <div className="rail-block">
        <select
          value={activePeriod}
          onChange={e => onPeriodChange(e.target.value)}
          className="period-select rail-period"
          title="Switch reporting month"
        >
          {periods.map(p => (
            <option key={p.label} value={p.label}>
              {p.label}{p.is_active ? ' · Active' : ''}
            </option>
          ))}
        </select>
        {span && <div className="rail-span">{span}</div>}
        <button className="rail-btn rail-quiet" onClick={onManagePeriods}
                style={{ padding: '4px 0', marginTop: 2 }}>
          <CalendarCog size={13} />
          <span>Manage months</span>
        </button>
        <span className="live-badge rail-live">
          <span className={`live-dot ${liveStatus.state === 'down' ? 'down' : ''}`} />
          {liveStatus.text}
        </span>
      </div>

      {/* The map. Anchors rather than scroll hijacking, so the browser's own
          back button still does what it should. */}
      <nav className="rail-nav">
        {sections.map(s => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className={activeSection === s.id ? 'is-here' : ''}
          >
            {s.label}
          </a>
        ))}
      </nav>

      {/* Six buttons is the longest thing in the rail, and most of the time the
          sheet is being read rather than written to. Folded away by default:
          the group states what it is, and opens when there is something to
          record. The rail scrolls, so this is a disclosure rather than a
          floating menu - a popover would be clipped by the rail's own
          overflow. */}
      <div
        className="rail-block"
        // Scoped to this group rather than bound to the window: the entry
        // drawer and the upload dialog both close on Escape, and a global
        // listener here would collapse the rail behind them.
        onKeyDown={e => {
          if (e.key === 'Escape' && recordOpen) {
            setRecordOpen(false);
            triggerRef.current?.focus();
          }
        }}
      >
        <button
          type="button"
          ref={triggerRef}
          className="rail-disclosure"
          aria-expanded={recordOpen}
          aria-controls="rail-record"
          onClick={() => setRecordOpen(o => !o)}
        >
          <span className="rail-legend">Record</span>
          <ChevronDown size={13} className={`rail-chevron${recordOpen ? ' is-open' : ''}`} />
        </button>

        <div id="rail-record" ref={recordRef}
             className={`rail-drawer${recordOpen ? ' is-open' : ''}`}>
          {/* The inner wrapper is what gets clipped while the row collapses;
              the group itself has to keep its natural height for the
              animation to have something to travel to. */}
          <div className="rail-drawer-inner" aria-hidden={!recordOpen}>
            {ENTRIES.map(({ tab, label, Icon }) => (
              <button key={tab} className="rail-btn" tabIndex={recordOpen ? 0 : -1}
                      onClick={() => onOpenDrawer(tab)}>
                <Icon size={14} />
                <span>{label}</span>
              </button>
            ))}
            <button className="rail-btn rail-btn-accent" tabIndex={recordOpen ? 0 : -1}
                    onClick={onOpenUpload}>
              <UploadCloud size={14} />
              <span>Upload report</span>
            </button>
            {/* The same door, the other way round: a workbook comes in above, and
                goes back out here. */}
            <button className="rail-btn rail-btn-accent" tabIndex={recordOpen ? 0 : -1}
                    onClick={onOpenExport}>
              <Download size={14} />
              <span>Export data</span>
            </button>
          </div>
        </div>
      </div>

      <div className="rail-foot">
        <button className="rail-btn rail-quiet" onClick={onRefresh} disabled={isRefreshing}>
          <RefreshCw size={13}
                     style={isRefreshing ? { animation: 'spin 0.9s linear infinite' } : undefined} />
          <span>{isRefreshing ? 'Refreshing' : 'Refresh'}</span>
        </button>
        <button className="rail-btn rail-quiet" onClick={onToggleTables} aria-pressed={showTables}>
          <Table size={13} />
          <span>{showTables ? 'Hide records' : 'Show records'}</span>
        </button>
        <button
          className="rail-btn rail-quiet"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
          <span>{theme === 'dark' ? 'Light sheet' : 'Night sheet'}</span>
        </button>
      </div>
    </aside>
  );
}
