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
import ChatWidget from './components/ChatWidget';
import SheetFooter from './components/SheetFooter';
import Loading from './components/Loading';
import PeriodManager from './components/PeriodManager';
import SalesTimeline from './components/SalesTimeline';
import Trends from './components/Trends';
import Composition from './components/Composition';
import AgentCalls from './components/AgentCalls';
import Visualizations from './components/Visualizations';
import {
  BookingPace, Commitments, StockAgeing, Backorders,
  ConsultantConversion, Attachments, DataQuality,
} from './components/Analytics';
import FolderTat from './components/FolderTat';
import { fetchDashboardData, activatePeriod, DASHBOARD_CALLS } from './api/client';
import { setupLiveEvents } from './api/liveEvents';

/**
 * A seam. Fourteen panels in one column read as an undifferentiated scroll, so
 * the page is divided into acts - the label sits on a rule the way a seam runs
 * across cloth, rather than being another heavy heading competing with the
 * panel titles beneath it.
 */
/**
 * The sheet is divided by department rather than by act.
 *
 * It used to be one scroll of fourteen panels with seams between them, which
 * reads as a single report and means anyone answering a question about stock
 * scrolls past the whole sales story to reach it. Split by who is asking:
 * sales, accounts, the people on the floor, the cars on it.
 *
 * Only the open tab renders. That is what makes this worth doing at all - the
 * page was mounting every chart on load, and Recharts is not cheap.
 *
 * Each tab is a hash, so the browser's back button works, a tab can be linked
 * to, and a reload stays where it was. The rail is the tab bar; it was already
 * a list of anchors pointing at seams, so it needed no new markup.
 */
const TABS = [
  { id: 'overview',  label: 'Overview',  note: 'Where the month stands' },
  { id: 'sales',     label: 'Sales',     note: 'Enquiries, demand and how the month is running' },
  { id: 'accounts',  label: 'Accounts',  note: 'Attachments and how fast paperwork clears' },
  { id: 'people',    label: 'People',    note: 'Consultants against their targets' },
  { id: 'inventory', label: 'Inventory', note: 'Stock by model, ageing, and orders awaiting a car' },
  { id: 'calls',     label: 'Calls',     note: 'What the agent handled on the phone' },
];
const TAB_IDS = TABS.map(t => t.id);

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

  // Which tab is open, read from the hash so back/forward and a pasted link
  // all work. The scroll spy this replaces measured seam positions on every
  // frame; with one tab on screen at a time there is nothing to spy on.
  const readHash = () => {
    const h = (window.location.hash || '').replace('#', '');
    return TAB_IDS.includes(h) ? h : TABS[0].id;
  };
  const [activeTab, setActiveTab] = useState(readHash);
  useEffect(() => {
    const onHash = () => {
      setActiveTab(readHash());
      // A tab is a new page as far as the reader is concerned, so it starts at
      // the top rather than halfway down wherever the last one was scrolled to.
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

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

  const tab = TABS.find(t => t.id === activeTab) || TABS[0];

  return (
    <div className="shell">
      <Rail
        periods={data?.periods || []}
        activePeriod={activePeriodObj.label || ''}
        onPeriodChange={handlePeriodChange}
        liveStatus={liveStatus}
        sections={TABS}
        activeSection={activeTab}
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
        {/* The tab's own title, so the sheet says which department it is
            showing. The rail marks it too, but the rail is 232px away and the
            eye is here. */}
        <div style={{ marginBottom: 22 }}>
          <h1 style={{ fontSize: 22, letterSpacing: '-0.02em' }}>{tab.label}</h1>
          {tab.note && (
            <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 5 }}>
              {tab.note}
            </div>
          )}
        </div>

        {activeTab === 'overview' && (
          <>
            <HeroMetric kpi={data?.kpi || {}} />
            <KpiTiles kpi={data?.kpi || {}} trends={data?.trends || {}} />
            <div style={{ marginTop: 26 }}>
              <SalesFunnel funnel={data?.funnel || {}} />
            </div>
            {/* Where the workbook disagrees with itself belongs on the first
                screen, not buried at the bottom of the longest tab. */}
            <div style={{ marginTop: 26 }}>
              <DataQuality issues={data?.dataQuality || []} />
            </div>
          </>
        )}

        {activeTab === 'sales' && (
          <>
            <Visualizations sources={data?.sources || []} models={data?.models || []} />
            <div style={{ marginBottom: 26 }}>
              <SalesTimeline refreshKey={data?.kpi?.bookings} />
            </div>
            <Trends refreshKey={data?.kpi?.bookings} />
            <Composition refreshKey={data?.kpi?.bookings} />
            {/* The funnel lives on Overview. Repeating it here would make the
                longest tab longer to say something already said. */}
            <BookingPace orderbook={data?.orderbook || []}
                         target={Number(data?.kpi?.booking_target) || 0} />
          </>
        )}

        {activeTab === 'accounts' && (
          <>
            <div className="grid-2" style={{ marginBottom: 26 }}>
              <Attachments attachments={data?.attachments || null} />
              <FolderTat />
            </div>
          </>
        )}

        {activeTab === 'people' && (
          <>
            <div style={{ marginBottom: 26 }}>
              <Leaderboard board={data?.board || []} />
            </div>
            <div className="grid-2">
              <ConsultantConversion scorecards={data?.scorecards || []} />
              <Commitments commitments={data?.commitments || []} />
            </div>
          </>
        )}

        {activeTab === 'inventory' && (
          <>
            <StockAndModels
              models={data?.models || []}
              ageing={data?.ageing || []}
              activity={data?.activity || []}
            />
            <div className="grid-2">
              <StockAgeing ageing={data?.ageing || []} />
              <Backorders backorders={data?.backorders || []} />
            </div>
          </>
        )}

        {activeTab === 'calls' && <AgentCalls />}

        {/* The record tables are a drill-down on whatever is on screen, so they
            follow the tab rather than living on one of them. */}
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

      {/* Perfox "Dashboard Insights" agent - internal staff copilot over
          live dashboard data. Renders nothing until VITE_PERFOX_SITE_ID is set. */}
      <ChatWidget />
    </div>
  );
}
