import React, { useState, useEffect, useCallback, useRef } from 'react';
import Rail from './components/Rail';
import HeroMetric from './components/HeroMetric';
import KpiTiles from './components/KpiTiles';
import SalesFunnel from './components/SalesFunnel';
import Leaderboard from './components/Leaderboard';
import StockAndModels from './components/StockAndModels';
import DataTables from './components/DataTables';
import EntryDrawer from './components/EntryDrawer';
import ExcelUploadModal from './components/ExcelUploadModal';
import ExportDataModal from './components/ExportDataModal';
import ToastContainer from './components/ToastContainer';
import SheetFooter from './components/SheetFooter';
import Loading from './components/Loading';
import PeriodManager from './components/PeriodManager';
import SalesTimeline from './components/SalesTimeline';
import Trends from './components/Trends';
import Visualizations from './components/Visualizations';
import Analytics from './components/Analytics';
import { fetchDashboardData, activatePeriod, DASHBOARD_CALLS } from './api/client';
import { setupLiveEvents } from './api/liveEvents';

/**
 * A seam. Fourteen panels in one column read as an undifferentiated scroll, so
 * the page is divided into acts - the label sits on a rule the way a seam runs
 * across cloth, rather than being another heavy heading competing with the
 * panel titles beneath it.
 */
const SECTIONS = [
  { id: 'month', label: 'This month', note: null },
  { id: 'sources', label: 'Where it comes from', note: 'Enquiries, demand and who is converting' },
  { id: 'running', label: 'How the month is running', note: 'Pace against target, and what is holding orders up' },
  { id: 'floor', label: 'What is on the floor', note: 'Stock by model and how long it has been standing' },
];

/**
 * A seam, and the anchor the rail points at. Fourteen panels in one column read
 * as an undifferentiated scroll, so the page is divided into acts - the label
 * sits on a rule the way a seam runs across cloth, rather than being another
 * heavy heading competing with the panel titles beneath it.
 */
function Seam({ id, label, note }) {
  return (
    <div id={id} style={{
      margin: '52px 0 22px', display: 'flex', alignItems: 'baseline', gap: '16px',
      scrollMarginTop: '24px',
    }}>
      <div style={{ flex: 'none' }}>
        <div style={{
          fontSize: '11px', letterSpacing: '0.2em', textTransform: 'uppercase',
          color: 'var(--ink-2)',
        }}>
          {label}
        </div>
        {note && (
          <div style={{ fontSize: '11.5px', color: 'var(--ink-muted)', marginTop: '3px' }}>
            {note}
          </div>
        )}
      </div>
      <div style={{
        flex: 1, height: '1px', transform: 'translateY(-4px)',
        background: 'linear-gradient(to right, var(--axis), transparent)',
      }} />
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [liveStatus, setLiveStatus] = useState({ state: 'off', text: 'connecting' });
  const [loaded, setLoaded] = useState(0);

  // UI States
  // The report sheet is the primary state: light reads as a printed document
  // rather than a tech demo, and it survives a projector in a meeting room.
  // The night sheet stays, one click away, for anyone working a late shift.
  const [theme, setTheme] = useState(() => localStorage.getItem('dsr.theme') || 'light');
  const [showTables, setShowTables] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState('booking');
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [periodsOpen, setPeriodsOpen] = useState(false);
  const [toasts, setToasts] = useState([]);

  // Toast Helper
  const addToast = useCallback((message, { bad = false } = {}) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, bad }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  }, []);

  // Theme synchronization
  useEffect(() => {
    // :root carries the dark palette, so it is LIGHT that is stamped on the
    // element - the reverse of the previous arrangement.
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    localStorage.setItem('dsr.theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Whether a load has ever succeeded, and the load currently in flight. Both
  // are refs rather than state on purpose: loadData must keep a stable
  // identity, or the effect below re-runs on every fetch.
  const hasLoadedRef = useRef(false);
  const inFlightRef = useRef(null);

  // Data fetching
  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setIsRefreshing(true);
    try {
      // A change event, the heartbeat and a Refresh click can all land
      // together, and one pass is sixteen requests against a database a round
      // trip away - left alone they queue behind the browser's per-host
      // connection limit until fetches time out. So concurrent callers JOIN the
      // run already in flight rather than starting another.
      //
      // Joining, not dropping: an earlier version returned early here, which
      // meant a Refresh clicked while the background heartbeat happened to be
      // running did nothing at all - no spinner, no result, no message.
      if (!inFlightRef.current) {
        inFlightRef.current = (async () => {
          try {
            setLoaded(0);
            return await fetchDashboardData(n => setLoaded(n));
          } finally {
            inFlightRef.current = null;
          }
        })();
      }
      const res = await inFlightRef.current;
      setData(res);
      hasLoadedRef.current = true;
      setError(null);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
      if (!hasLoadedRef.current) setError(err.message || 'Failed to connect to CRM API');
      addToast(`Refresh failed: ${err.message}`, { bad: true });
    } finally {
      setLoading(false);
      if (!quiet) setIsRefreshing(false);
    }
  }, [addToast]);

  // Initial fetch and SSE event wiring. loadData is stable, so this runs once -
  // when it also depended on `data` the effect re-ran after every fetch, which
  // reloaded the dashboard in a loop and tore the event stream down with it.
  useEffect(() => {
    loadData();

    const cleanup = setupLiveEvents(
      () => loadData(true),
      (state, text) => setLiveStatus({ state, text })
    );

    return cleanup;
  }, [loadData]);

  // Which act is on screen, so the rail can mark it.
  //
  // This reads positions on scroll rather than using an IntersectionObserver:
  // the seams are thin, so an observer band narrow enough to mean "at the top"
  // is one a 40px seam can cross between frames, and the marker never moved off
  // the first section. Reading which seam was the last to pass the line is
  // exact, and a rAF gate keeps it to one measurement per painted frame.
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);
  useEffect(() => {
    if (!data) return undefined;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = 160;
      let current = SECTIONS[0].id;
      SECTIONS.forEach(({ id }) => {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      });
      setActiveSection(current);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [data]);

  // Handle active period change
  const handlePeriodChange = async (newPeriod) => {
    try {
      await activatePeriod(newPeriod);
      addToast(`Activated month: ${newPeriod}`);
      await loadData();
    } catch (err) {
      addToast(`Could not switch month: ${err.message}`, { bad: true });
    }
  };

  const handleOpenDrawer = (tab = 'booking') => {
    setDrawerTab(tab);
    setDrawerOpen(true);
  };

  if (loading && !data) {
    return <Loading done={loaded} total={DASHBOARD_CALLS} />;
  }

  if (error && !data) {
    return (
      <div className="wrap">
        <div className="panel" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <h2>Could not connect to CRM API</h2>
          <p style={{ color: 'var(--ink-muted)', margin: '8px 0 20px' }}>{error}</p>
          <button className="primary" onClick={() => loadData()}>Retry Connection</button>
        </div>
      </div>
    );
  }

  const activePeriodObj = data?.periods?.find(p => p.is_active) || data?.periods?.[0] || {};

  const seam = id => SECTIONS.find(x => x.id === id) || {};

  return (
    <div className="shell">
      <Rail
        periods={data?.periods || []}
        activePeriod={activePeriodObj.label || ''}
        onPeriodChange={handlePeriodChange}
        liveStatus={liveStatus}
        sections={SECTIONS}
        activeSection={activeSection}
        onOpenDrawer={handleOpenDrawer}
        onOpenUpload={() => setUploadModalOpen(true)}
        onOpenExport={() => setExportModalOpen(true)}
        onRefresh={() => {
          addToast('Pulling the latest figures…');
          loadData();
        }}
        isRefreshing={isRefreshing}
        showTables={showTables}
        onToggleTables={() => setShowTables(prev => !prev)}
        onManagePeriods={() => setPeriodsOpen(true)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <main className="sheet">
        <div id="month" style={{ scrollMarginTop: '24px' }}>
          <HeroMetric kpi={data?.kpi || {}} />
          <KpiTiles kpi={data?.kpi || {}} trends={data?.trends || {}} />
        </div>

        <Seam {...seam('sources')} />

      <Visualizations sources={data?.sources || []} models={data?.models || []} />

      <div className="grid-2">
        <SalesFunnel funnel={data?.funnel || {}} />
        <Leaderboard board={data?.board || []} />
      </div>

        <Seam {...seam('running')} />

        <div style={{ marginBottom: 26 }}>
          <SalesTimeline refreshKey={data?.kpi?.bookings} />
        </div>

        <Trends refreshKey={data?.kpi?.bookings} />

      <Analytics
        orderbook={data?.orderbook || []}
        commitments={data?.commitments || []}
        ageing={data?.ageing || []}
        backorders={data?.backorders || []}
        scorecards={data?.scorecards || []}
        attachments={data?.attachments || null}
        dataQuality={data?.dataQuality || []}
        kpi={data?.kpi || {}}
      />

        <Seam {...seam('floor')} />

      <StockAndModels
        models={data?.models || []}
        ageing={data?.ageing || []}
        activity={data?.activity || []}
      />

      {showTables && (
        <DataTables
          orderbook={data?.orderbook || []}
          sources={data?.sources || []}
          backorders={data?.backorders || []}
        />
      )}

      <SheetFooter
        kpi={data?.kpi || {}}
        period={activePeriodObj}
        board={data?.board || []}
        liveStatus={liveStatus}
      />
      </main>

      {/* Overlays sit outside the sheet so the rail cannot clip them. */}
      <PeriodManager
        isOpen={periodsOpen}
        periods={data?.periods || []}
        onClose={() => setPeriodsOpen(false)}
        onChanged={(msg) => {
          addToast(msg);
          loadData(true);
        }}
      />

      <EntryDrawer
        isOpen={drawerOpen}
        activeTab={drawerTab}
        onClose={() => setDrawerOpen(false)}
        options={data?.options || {}}
        activePeriod={activePeriodObj}
        onSaved={(msg) => {
          addToast(msg);
          loadData(true);
        }}
      />

      {/* Drag & Drop Excel Upload Modal */}
      <ExcelUploadModal
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        onUploadComplete={(msg) => {
          addToast(msg);
          loadData(true);
        }}
      />

      {/* The way back out: the live tables as a workbook or a CSV set. An
          export only reads, so there is nothing to reload afterwards. */}
      <ExportDataModal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        onExported={(msg) => addToast(msg)}
      />

      {/* Toasts */}
      <ToastContainer toasts={toasts} />
    </div>
  );
}
