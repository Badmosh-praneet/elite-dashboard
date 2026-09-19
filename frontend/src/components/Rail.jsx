/**
 * The left rail.
 *
 * Everything that was competing for the top of the page - identity, the period
 * control, live state, the entry actions, the view toggles - now lives down the
 * side, where it stays put while the sheet scrolls past it. The page was 4,500
 * pixels tall with no way to get anywhere; the rail is also the map.
 */

import React from 'react';
import {
  PlusCircle, UserPlus, Compass, KeyRound, UploadCloud, Download,
  RefreshCw, Table, Sun, Moon, Headset, CalendarCog
} from 'lucide-react';

const ENTRIES = [
  { tab: 'booking', label: 'New booking', Icon: PlusCircle },
  { tab: 'lead', label: 'New lead', Icon: UserPlus },
  { tab: 'testdrive', label: 'Test drive', Icon: Compass },
  { tab: 'allotment', label: 'Allotment', Icon: KeyRound },
];

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

      <div className="rail-block">
        <div className="rail-legend">Record</div>
        {ENTRIES.map(({ tab, label, Icon }) => (
          <button key={tab} className="rail-btn" onClick={() => onOpenDrawer(tab)}>
            <Icon size={14} />
            <span>{label}</span>
          </button>
        ))}
        <button className="rail-btn rail-btn-accent" onClick={onOpenUpload}>
          <UploadCloud size={14} />
          <span>Upload report</span>
        </button>
        {/* The same door, the other way round: a workbook comes in above, and
            goes back out here. */}
        <button className="rail-btn rail-btn-accent" onClick={onOpenExport}>
          <Download size={14} />
          <span>Export data</span>
        </button>
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
