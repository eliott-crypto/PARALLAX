import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard,
  Radar,
  Network,
  Telescope,
  History,
  Search,
  Settings2,
  ChevronDown,
  Plus,
  ArrowUpRight,
  ArrowRight,
  ExternalLink,
  X,
  Command,
  Sparkles,
  ChevronRight,
  Bookmark,
  SlidersHorizontal,
  RefreshCw,
  BookOpen,
  LoaderCircle,
  Globe2,
  Info,
  Check,
  Bell,
  PanelLeftClose,
  ShieldCheck,
  AlertTriangle,
  Terminal,
  Copy,
} from 'lucide-react';
import type {
  ApiStatus,
  RadarData,
  Signal,
  Investigation,
  Evidence,
  Company,
} from '../shared/types';
import { api, post, dateLabel, readable } from './lib/api';
import { Brand, CausalMap, EvidenceChart, MiniVisual, OrbitGraphic } from './components/Visuals';
import InvestigationRoom from './components/InvestigationRoom';

type Page = 'Overview' | 'Signal Radar' | 'Investigations' | 'Watchtower' | 'Research History';
const NAV = [
  { name: 'Overview', icon: LayoutDashboard },
  { name: 'Signal Radar', icon: Radar },
  { name: 'Investigations', icon: Network },
  { name: 'Watchtower', icon: Telescope },
  { name: 'Research History', icon: History },
] as const;
const sectorMatches = (actual: string, selected: string) =>
  selected === 'All sectors' ||
  actual.toLowerCase().includes(selected.toLowerCase()) ||
  selected.toLowerCase().includes(actual.toLowerCase()) ||
  (selected === 'Artificial intelligence' &&
    /\bai\b|artificial intelligence|machine learning/i.test(actual)) ||
  (selected === 'Climate and energy' && /climate|energy|power/i.test(actual));
const SECTORS = [
  'All sectors',
  'Artificial intelligence',
  'Developer tools',
  'Cybersecurity',
  'Robotics',
  'Climate and energy',
  'Healthcare technology',
  'Fintech',
];
export default function App() {
  const [page, setPage] = useState<Page>('Overview');
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [radar, setRadar] = useState<RadarData | null>(null);
  const [runs, setRuns] = useState<Investigation[]>([]);
  const [current, setCurrent] = useState<Investigation | null>(null);
  const [sample, setSample] = useState<Investigation | null>(null);
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState('All sectors');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<'research' | 'settings' | 'search' | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [sourceDrawer, setSourceDrawer] = useState<{ evidence: Evidence[]; ids?: string[] } | null>(
    null,
  );
  const [sourceFilter, setSourceFilter] = useState('All sources');
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [company, setCompany] = useState<Company | undefined>();
  const [pendingSignalId, setPendingSignalId] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4000);
  }, []);
  useEffect(() => {
    Promise.allSettled([
      api<ApiStatus>('/api/status'),
      api<RadarData>('/api/radar'),
      api<Investigation[]>('/api/investigations'),
      api<Investigation>('/api/sample'),
    ]).then((results) => {
      const [a, b, c, d] = results;
      if (a.status === 'fulfilled') setStatus(a.value);
      if (b.status === 'fulfilled') setRadar(b.value);
      else setError(b.reason.message);
      if (c.status === 'fulfilled') setRuns(c.value);
      if (d.status === 'fulfilled') setSample(d.value);
      setLoading(false);
    });
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setModal((m) => (m === 'search' ? null : 'search'));
      }
      if (e.key === 'Escape') {
        setModal(null);
        setSourceDrawer(null);
        setSelectedSignal(null);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    if (!current || current.status !== 'running') return;
    let source: EventSource | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    const receive = (run: Investigation) => {
      setCurrent(run);
      setRuns((prev) => [run, ...prev.filter((r) => r.id !== run.id)]);
      if (run.status !== 'running') {
        source?.close();
        if (poll) clearInterval(poll);
        api<ApiStatus>('/api/status')
          .then(setStatus)
          .catch(() => {});
        notify(
          run.status === 'completed'
            ? 'Investigation complete. Your assessment is ready.'
            : `Investigation ${run.status}. Available findings are preserved.`,
        );
      }
    };
    source = new EventSource(`/api/investigations/${current.id}/events`);
    source.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.agents) receive(data);
        else if (data.investigation?.agents) receive(data.investigation);
      } catch {}
    };
    source.onerror = () => {
      source?.close();
    };
    poll = setInterval(
      () =>
        api<Investigation>(`/api/investigations/${current.id}`)
          .then(receive)
          .catch(() => {}),
      4000,
    );
    return () => {
      source?.close();
      if (poll) clearInterval(poll);
    };
  }, [current?.id, current?.status, notify]);
  function navigate(next: Page) {
    setPage(next);
    setCurrent(null);
    setSearch('');
    setMobileNav(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function openRun(run: Investigation) {
    setCurrent(run);
    setPage('Investigations');
    setModal(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function prepareResearch(signal?: Signal, target?: Company) {
    setQuery(
      signal
        ? `${signal.title}. Investigate the commercial opportunity${target ? ` for ${target.name} (${target.website})` : ''}, its supporting evidence, and the strongest counterargument.`
        : '',
    );
    setCompany(target);
    setPendingSignalId(signal?.id);
    setSelectedSignal(null);
    setModal('research');
    setError('');
  }
  async function startRun() {
    if (query.trim().length < 3) return;
    setRunLoading(true);
    setError('');
    try {
      const run = await post<Investigation>('/api/investigations', {
        query,
        company,
        signalId: pendingSignalId,
      });
      setRuns((prev) => [run, ...prev]);
      openRun(run);
      setStatus((prev) => (prev ? { ...prev, activeRuns: prev.activeRuns + 1 } : prev));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunLoading(false);
    }
  }
  async function scan() {
    setScanLoading(true);
    setError('');
    try {
      const data = await post<RadarData>('/api/scan', { sector, query: search || undefined });
      setRadar(data);
      notify(`${data.signals.length} evidence-backed signals retrieved.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScanLoading(false);
    }
  }
  async function updateWatch(run: Investigation) {
    try {
      const updated = await api<Investigation>(`/api/investigations/${run.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ watched: !run.watched }),
      });
      setCurrent((prev) => (prev?.id === updated.id ? updated : prev));
      setRuns((prev) => [updated, ...prev.filter((r) => r.id !== updated.id)]);
      setSample((prev) => (prev?.id === updated.id ? updated : prev));
      notify(updated.watched ? 'Thesis saved to Watchtower.' : 'Thesis removed from Watchtower.');
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function recheck(run: Investigation) {
    if (run.mode === 'sample') {
      setQuery(run.query);
      setCompany(run.company);
      setPendingSignalId(run.signalId);
      setModal('research');
      return;
    }
    try {
      const next = await post<Investigation>(`/api/investigations/${run.id}/recheck`);
      setRuns((prev) => [next, ...prev]);
      openRun(next);
    } catch (e) {
      setError((e as Error).message);
      notify((e as Error).message);
      if (!status?.configured) setModal('settings');
    }
  }
  async function cancel() {
    if (!current) return;
    try {
      const updated = await post<Investigation>(`/api/investigations/${current.id}/cancel`);
      setCurrent(updated);
      setRuns((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    } catch (e) {
      notify((e as Error).message);
    }
  }
  const evidence = radar?.evidence ?? [];
  const signals = (radar?.signals ?? []).filter(
    (s) =>
      sectorMatches(s.sector, sector) &&
      `${s.title} ${s.summary} ${s.sector} ${s.companies.map((c) => c.name).join(' ')}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const companies = Array.from(
    new Map((radar?.signals ?? []).flatMap((s) => s.companies).map((c) => [c.id, c])).values(),
  );
  const watched = runs.filter((r) => r.watched);
  const active = runs.filter((r) => r.status === 'running').length;
  const shownRuns = (page === 'Watchtower' ? watched : runs).filter((r) =>
    `${r.title} ${r.query}`.toLowerCase().includes(search.toLowerCase()),
  );
  const heroSignal = signals[0] ?? radar?.signals[0];
  const openSources = (ids?: string[], ev: Evidence[] = current?.evidence ?? evidence) => {
    setSourceDrawer({ evidence: ev, ids });
    setSourceFilter('All sources');
  };
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
        <div className="sidebar-brand">
          <Brand />
          <button
            className="icon-button sidebar-collapse"
            onClick={() => setMobileNav(false)}
            title="Close navigation"
          >
            <PanelLeftClose size={16} />
          </button>
        </div>
        <button className="workspace-switch" onClick={() => setModal('settings')}>
          <span className="workspace-monogram">P</span>
          <div>
            <strong>Research workspace</strong>
            <small>Venture intelligence</small>
          </div>
          <ChevronDown size={13} />
        </button>
        <div className="nav-caption">WORKSPACE</div>
        <nav>
          {NAV.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={`nav-item ${page === name ? 'active' : ''}`}
              onClick={() => navigate(name)}
            >
              <span className="nav-icon">
                <Icon size={18} strokeWidth={1.5} />
              </span>
              <span>{name}</span>
              {name === 'Investigations' && active > 0 && (
                <span className="nav-count">{active}</span>
              )}
              {name === 'Watchtower' && watched.length > 0 && (
                <span className="nav-count">{watched.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <button className="nav-item" onClick={() => openSources(undefined, evidence)}>
          <span className="nav-icon">
            <BookOpen size={18} strokeWidth={1.5} />
          </span>
          <span>Evidence library</span>
          <ArrowUpRight size={13} className="nav-trailing" />
        </button>
        <button className="nav-item" onClick={() => setModal('settings')}>
          <span className="nav-icon">
            <Settings2 size={18} strokeWidth={1.5} />
          </span>
          <span>Workspace settings</span>
        </button>
        <div className="sidebar-bottom">
          <div className="sidebar-promo">
            <div className="promo-stars" />
            <span>THE RESEARCH ADVANTAGE</span>
            <h3>
              See what others
              <br />
              haven’t connected.
            </h3>
            <p>
              Nine perspectives.
              <br />
              One evidence-backed thesis.
            </p>
            <button onClick={() => sample && openRun(sample)}>
              Explore research sample <ArrowUpRight size={15} />
            </button>
          </div>
          <button className="profile" onClick={() => setModal('settings')}>
            <span className="profile-avatar">P</span>
            <div>
              <strong>Personal workspace</strong>
              <small>{status?.configured ? 'Claude connected' : 'Sample workspace'}</small>
            </div>
            <Settings2 size={15} />
          </button>
        </div>
      </aside>
      {mobileNav && <div className="nav-overlay" onClick={() => setMobileNav(false)} />}
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <button className="mobile-logo" onClick={() => setMobileNav(!mobileNav)}>
              <Brand compact />
            </button>
            <Globe2 size={19} strokeWidth={1.4} />
            <span>{current ? 'Investigation room' : page}</span>
          </div>
          <div className="topbar-right">
            <button className="global-search" onClick={() => setModal('search')}>
              <Search size={17} />
              <span>Search anything</span>
              <kbd>⌘ K</kbd>
            </button>
            <button className="connection-pill" onClick={() => setModal('settings')}>
              <span className={`status-dot ${status?.configured ? 'connected' : ''}`} />
              {status?.configured ? 'Claude connected' : 'Sample mode'}
              <ChevronDown size={12} />
            </button>
            <button className="topbar-avatar" onClick={() => setModal('settings')}>
              P
            </button>
          </div>
        </header>
        <div className="main-content">
          {current ? (
            <InvestigationRoom
              investigation={current}
              onBack={() => navigate('Investigations')}
              onEvidence={(ids) => openSources(ids, current.evidence)}
              onWatch={() => updateWatch(current)}
              onRecheck={() => recheck(current)}
              onCancel={cancel}
            />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    AUTONOMOUS VENTURE INTELLIGENCE <span className="eyebrow-line" />
                  </div>
                  <h1>
                    {page === 'Overview'
                      ? 'Intelligence before consensus.'
                      : page === 'Signal Radar'
                        ? 'The next opportunity starts here.'
                        : page === 'Watchtower'
                          ? 'Conviction deserves a second look.'
                          : page === 'Research History'
                            ? 'Every investigation. Every perspective.'
                            : 'A research team for every thesis.'}
                  </h1>
                  <p>
                    {page === 'Overview'
                      ? 'Connect emerging signals to the companies positioned to benefit.'
                      : page === 'Signal Radar'
                        ? 'Find the changes that matter. Trace their consequences. Follow the evidence.'
                        : page === 'Watchtower'
                          ? 'Save your theses and recheck them against new evidence, on demand.'
                          : page === 'Research History'
                            ? 'Your research, decisions and cited evidence, preserved.'
                            : 'Independent agents. Adversarial reasoning. Evidence you can inspect.'}
                  </p>
                </div>
                <div className="heading-actions">
                  <button className="button ghost" onClick={() => sample && openRun(sample)}>
                    <BookOpen size={15} />
                    Explore sample
                  </button>
                  <button className="button primary" onClick={() => prepareResearch()}>
                    <Plus size={16} />
                    New investigation
                  </button>
                </div>
              </div>
              {error && (
                <div className="error-banner">
                  <AlertTriangle size={16} />
                  <span>{error}</span>
                  {!status?.configured && (
                    <button className="text-button" onClick={() => setModal('settings')}>
                      Configure Claude <ArrowUpRight size={13} />
                    </button>
                  )}
                  <button className="icon-button" onClick={() => setError('')}>
                    <X size={15} />
                  </button>
                </div>
              )}
              {(page === 'Overview' || page === 'Signal Radar') && (
                <>
                  <div className="sample-context">
                    <span className={`status-dot ${radar?.mode === 'live' ? 'connected' : ''}`} />
                    <span>
                      {radar?.mode === 'live' ? 'Live research results' : 'Curated research sample'}
                    </span>
                    <span className="context-divider">/</span>
                    <span>
                      {radar?.mode === 'live'
                        ? `Retrieved ${dateLabel(radar.updatedAt)}`
                        : 'Historical catalysts · real sources · illustrative theses'}
                    </span>
                    <button onClick={() => setModal('settings')}>
                      <Info size={13} />
                    </button>
                  </div>
                  {radar?.warning && <div className="subtle-notice">{radar.warning}</div>}
                  {page === 'Overview' && (
                    <div className="metric-grid">
                      <Metric
                        label="Signals in focus"
                        value={String(radar?.signals.length ?? 0).padStart(2, '0')}
                        detail={
                          radar?.mode === 'live'
                            ? 'Retrieved opportunities'
                            : 'Curated opportunity signals'
                        }
                        variant={0}
                      />
                      <Metric
                        label="Companies discovered"
                        value={String(companies.length).padStart(2, '0')}
                        detail="Connected to emerging theses"
                        variant={1}
                      />
                      <Metric
                        label="Evidence sources"
                        value={String(evidence.length).padStart(2, '0')}
                        detail="Traceable, inspectable citations"
                        variant={2}
                      />
                      <Metric
                        label="Research perspectives"
                        value="09"
                        detail="One adversarial research team"
                        variant={3}
                      />
                    </div>
                  )}
                  <div className="section-heading">
                    <div>
                      <h2>
                        Signal radar{' '}
                        <span className="subtle-badge">
                          {radar?.mode === 'live' ? 'RESEARCHED' : 'SAMPLE'}
                        </span>
                      </h2>
                      <p>Changes worth a closer look.</p>
                    </div>
                    <div className="section-controls">
                      <div className="select-wrap">
                        <SlidersHorizontal size={13} />
                        <select
                          aria-label="Filter by sector"
                          value={sector}
                          onChange={(e) => setSector(e.target.value)}
                        >
                          {SECTORS.map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                        <ChevronDown size={12} />
                      </div>
                      <button className="button small ghost" onClick={scan} disabled={scanLoading}>
                        {scanLoading ? (
                          <LoaderCircle size={14} className="spinning" />
                        ) : (
                          <RefreshCw size={14} />
                        )}{' '}
                        {scanLoading ? 'Scanning sources…' : 'Scan for signals'}
                      </button>
                    </div>
                  </div>
                  {page === 'Signal Radar' && (
                    <div className="radar-search">
                      <Search size={17} />
                      <input
                        placeholder="Search signals, companies or a research theme…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      {search && (
                        <button className="icon-button" onClick={() => setSearch('')}>
                          <X size={15} />
                        </button>
                      )}
                    </div>
                  )}
                  {scanLoading && (
                    <div className="scan-progress">
                      <span className="scan-progress-line" />
                      <Radar size={19} />
                      <div>
                        <strong>The Scout is researching public sources.</strong>
                        <p>
                          A live scan can take a minute. Signals will appear with their supporting
                          citations.
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="signal-grid">
                    {loading ? (
                      <>
                        {[0, 1, 2].map((i) => (
                          <div className="panel skeleton" key={i} />
                        ))}
                      </>
                    ) : signals.length ? (
                      signals
                        .slice(0, page === 'Overview' ? 3 : undefined)
                        .map((signal, i) => (
                          <SignalCard
                            key={signal.id}
                            signal={signal}
                            index={i}
                            onOpen={() => setSelectedSignal(signal)}
                            onResearch={() => prepareResearch(signal, signal.companies[0])}
                          />
                        ))
                    ) : (
                      <div className="panel empty-state">
                        <Radar size={25} />
                        <h3>No signals match this filter.</h3>
                        <p>Try another sector or scan for new evidence.</p>
                        <button
                          className="button ghost"
                          onClick={() => {
                            setSector('All sectors');
                            setSearch('');
                          }}
                        >
                          Reset filters
                        </button>
                      </div>
                    )}
                  </div>
                  {page === 'Overview' && (
                    <>
                      <div className="analysis-grid">
                        <section className="panel causal-panel">
                          <div className="panel-heading">
                            <div>
                              <h3>From signal to opportunity</h3>
                              <p>Follow the second-order effects.</p>
                            </div>
                            <button
                              className="icon-button"
                              title="Explore causal thesis"
                              onClick={() => heroSignal && setSelectedSignal(heroSignal)}
                            >
                              <ArrowUpRight size={17} />
                            </button>
                          </div>
                          <CausalMap
                            signal={heroSignal}
                            onInvestigate={() =>
                              heroSignal && prepareResearch(heroSignal, heroSignal.companies[0])
                            }
                          />
                          <div className="causal-legend">
                            <span>
                              <i className="color-dot" style={{ background: '#8bc7bd' }} />
                              Verified trigger
                            </span>
                            <span>
                              <i className="color-dot" style={{ background: '#b3a0dd' }} />
                              Reasoned hypothesis
                            </span>
                            <span>Every link can be challenged.</span>
                          </div>
                        </section>
                        <section className="panel evidence-panel">
                          <div className="panel-heading">
                            <div>
                              <h3>Quality over noise.</h3>
                              <p>
                                Source mix in this {radar?.mode === 'live' ? 'research' : 'sample'}.
                              </p>
                            </div>
                            <button
                              className="icon-button"
                              title="Open evidence library"
                              onClick={() => openSources()}
                            >
                              <ArrowUpRight size={17} />
                            </button>
                          </div>
                          <EvidenceChart evidence={evidence} />
                          <button className="panel-bottom-link" onClick={() => openSources()}>
                            Explore the evidence library <ArrowUpRight size={14} />
                          </button>
                        </section>
                      </div>
                      <div className="bottom-grid">
                        <section className="panel companies-panel">
                          <div className="panel-heading">
                            <div>
                              <h3>Companies on the horizon</h3>
                              <p>Discovered through the thesis, not the other way around.</p>
                            </div>
                            <span className="subtle-badge">{companies.length} COMPANIES</span>
                          </div>
                          <div className="company-table">
                            <div className="company-table-head">
                              <span>COMPANY / CATEGORY</span>
                              <span>THESIS ALIGNMENT</span>
                              <span>RESEARCH</span>
                            </div>
                            {companies.slice(0, 4).map((c, i) => (
                              <div className="company-row" key={c.id}>
                                <div className="company-identity">
                                  <span className={`company-avatar color-${i % 4}`}>
                                    {c.name.slice(0, 1)}
                                  </span>
                                  <div>
                                    <a href={c.website} target="_blank" rel="noopener noreferrer">
                                      {c.name}
                                      <ArrowUpRight size={11} />
                                    </a>
                                    <small>{c.category}</small>
                                  </div>
                                </div>
                                <p>{c.alignment}</p>
                                <button
                                  className="icon-button company-investigate"
                                  title={`Investigate ${c.name}`}
                                  onClick={() =>
                                    prepareResearch(
                                      (radar?.signals ?? []).find((s) =>
                                        s.companies.some((x) => x.id === c.id),
                                      ),
                                      c,
                                    )
                                  }
                                >
                                  <ArrowUpRight size={17} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </section>
                        <section className="panel source-feed">
                          <div className="panel-heading">
                            <div>
                              <h3>The source feed</h3>
                              <p>Evidence behind the perspective.</p>
                            </div>
                            <button
                              className="icon-button"
                              title="View all sources"
                              onClick={() => openSources()}
                            >
                              <ArrowUpRight size={17} />
                            </button>
                          </div>
                          {evidence.slice(0, 4).map((e, i) => (
                            <a
                              className="source-item"
                              key={e.id}
                              href={e.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <span className="source-number">0{i + 1}</span>
                              <div>
                                <small>
                                  {e.publisher}
                                  <span>↗</span>
                                </small>
                                <strong>{e.title}</strong>
                                <span className="source-date">{dateLabel(e.publishedAt)}</span>
                              </div>
                            </a>
                          ))}
                        </section>
                      </div>
                    </>
                  )}
                </>
              )}
              {(page === 'Investigations' ||
                page === 'Watchtower' ||
                page === 'Research History') && (
                <>
                  <div className="investigation-toolbar">
                    <div className="tabs">
                      <button className="selected">
                        {page === 'Watchtower'
                          ? 'Saved theses'
                          : page === 'Research History'
                            ? 'All research'
                            : 'Your investigations'}
                        <span>{shownRuns.length}</span>
                      </button>
                    </div>
                    <div className="table-search">
                      <Search size={15} />
                      <input
                        placeholder="Find an investigation…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                  </div>
                  {page === 'Watchtower' && (
                    <div className="watchtower-notice">
                      <Telescope size={19} />
                      <span>
                        <b>Conviction evolves with evidence.</b> Recheck a saved thesis to launch
                        fresh research and compare assumptions. Checks run when you request them.
                      </span>
                    </div>
                  )}
                  {shownRuns.length ? (
                    <div className="investigation-list">
                      {shownRuns.map((run) => (
                        <article className="panel investigation-card" key={run.id}>
                          <button className="investigation-card-main" onClick={() => openRun(run)}>
                            <div className="investigation-card-symbol">
                              <Network size={25} strokeWidth={1.2} />
                            </div>
                            <div>
                              <div className="investigation-meta">
                                <span
                                  className={`status-dot ${run.status === 'running' ? 'active' : ''}`}
                                />
                                {run.status === 'running'
                                  ? 'LIVE RESEARCH'
                                  : run.mode === 'sample'
                                    ? 'RESEARCH SAMPLE'
                                    : 'RECORDED RUN'}
                                <span>·</span>
                                {dateLabel(run.createdAt)}
                              </div>
                              <h3>{run.title}</h3>
                              <p>{run.query}</p>
                              <div className="investigation-chips">
                                <span>
                                  {run.agents.filter((a) => a.status === 'completed').length}/9
                                  agents completed
                                </span>
                                <span>{run.evidence.length} cited sources</span>
                                {run.decision && (
                                  <span className="decision-chip">{readable(run.decision)}</span>
                                )}
                              </div>
                            </div>
                            <ArrowUpRight size={19} />
                          </button>
                          <div className="investigation-card-actions">
                            <button
                              className={`text-button ${run.watched ? 'is-watched' : ''}`}
                              onClick={() => updateWatch(run)}
                            >
                              <Bookmark size={14} fill={run.watched ? 'currentColor' : 'none'} />
                              {run.watched ? 'Saved to Watchtower' : 'Watch thesis'}
                            </button>
                            <button className="text-button" onClick={() => recheck(run)}>
                              <RefreshCw size={13} />
                              Recheck thesis
                            </button>
                            <span className="badge">{readable(run.status)}</span>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="panel research-empty">
                      <OrbitGraphic />
                      <div className="eyebrow">
                        {page === 'Watchtower'
                          ? 'A PLACE FOR YOUR CONVICTION'
                          : 'RESEARCH WITH A DIFFERENT PERSPECTIVE'}
                      </div>
                      <h2>
                        {search
                          ? 'No matching investigations.'
                          : page === 'Watchtower'
                            ? 'Keep your best theses in view.'
                            : 'Your next thesis starts with a question.'}
                      </h2>
                      <p>
                        {page === 'Watchtower'
                          ? 'Save a completed investigation to follow its assumptions and recheck when the world changes.'
                          : 'Give nine independent agents a signal or a company. Watch them build, challenge and verify the investment case.'}
                      </p>
                      <div className="empty-actions">
                        <button className="button primary" onClick={() => prepareResearch()}>
                          <Plus size={15} />
                          Start an investigation
                        </button>
                        <button className="button ghost" onClick={() => sample && openRun(sample)}>
                          Explore sample <ArrowUpRight size={15} />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
          <footer className="app-footer">
            <span>
              <Brand compact />
              Built for a different perspective.
            </span>
            <span>
              Evidence first. Assumptions visible.<span className="footer-divider">/</span> PARALLAX
              © 2026
            </span>
          </footer>
        </div>
      </main>
      {toast && (
        <div className="toast">
          <Check size={16} />
          {toast}
          <button className="icon-button" onClick={() => setToast('')}>
            <X size={13} />
          </button>
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!runLoading) setModal(null);
          }}
        >
          <section
            className={`modal ${modal === 'search' ? 'search-modal' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="icon-button modal-close"
              title="Close dialog"
              onClick={() => setModal(null)}
            >
              <X size={19} />
            </button>
            {modal === 'research' ? (
              <>
                <div className="modal-icon">
                  <Network size={25} strokeWidth={1.3} />
                </div>
                <div className="eyebrow">THE INVESTIGATION ROOM</div>
                <h2 id="modal-title">What deserves a closer look?</h2>
                <p>
                  A catalyst, a company, or a thesis. Your research team will find the evidence,
                  connect the consequences and challenge the case.
                </p>
                <label className="field-label" htmlFor="research-query">
                  RESEARCH QUESTION
                </label>
                <textarea
                  id="research-query"
                  autoFocus
                  placeholder="e.g. How does cheaper AI inference change the opportunity for voice-agent infrastructure? Investigate LiveKit."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  maxLength={600}
                />
                <div className="textarea-meta">
                  <span>Specific questions lead to stronger research.</span>
                  <span>{query.length}/600</span>
                </div>
                <div className="research-scope">
                  <span>
                    <ShieldCheck size={15} />9 independent agents
                  </span>
                  <span>
                    <Globe2 size={15} />
                    Live web research
                  </span>
                  <span>
                    <BookOpen size={15} />
                    Cited assessment
                  </span>
                </div>
                {error && (
                  <div className="error-banner">
                    <AlertTriangle size={16} />
                    <span>{error}</span>
                  </div>
                )}
                {!status?.configured && (
                  <div className="config-notice">
                    <Info size={17} />
                    <span>
                      Live research needs a server-side Anthropic API key.{' '}
                      <button
                        onClick={() => {
                          setModal('settings');
                          setError('');
                        }}
                      >
                        View setup
                      </button>{' '}
                      or explore the research sample.
                    </span>
                  </div>
                )}
                <button
                  className="button primary full-width"
                  onClick={startRun}
                  disabled={query.trim().length < 3 || runLoading}
                >
                  {runLoading ? (
                    <LoaderCircle size={16} className="spinning" />
                  ) : (
                    <Sparkles size={16} />
                  )}{' '}
                  {runLoading ? 'Starting research…' : 'Launch investigation'}
                  <ArrowRight size={16} />
                </button>
                <p className="modal-footnote">
                  Bounded live research. Progress reflects actual agent execution.
                </p>
              </>
            ) : modal === 'settings' ? (
              <>
                <div className="modal-icon">
                  <Settings2 size={24} />
                </div>
                <div className="eyebrow">WORKSPACE SETTINGS</div>
                <h2 id="modal-title">Your research engine.</h2>
                <p>
                  PARALLAX uses Claude with web search to independently research, challenge and
                  verify a thesis.
                </p>
                <div className="settings-status">
                  <span className={`status-dot ${status?.configured ? 'connected' : ''}`} />
                  <div>
                    <strong>
                      {status?.configured ? 'Claude is connected' : 'Claude is not configured'}
                    </strong>
                    <small>
                      {status?.configured
                        ? 'Ready for genuine multi-agent research.'
                        : 'Explore curated research while you connect your engine.'}
                    </small>
                  </div>
                  <span className="badge">{status?.configured ? 'Ready' : 'Setup needed'}</span>
                </div>
                <div className="settings-rows">
                  <div>
                    <span>Research model</span>
                    <code>{status?.model ?? 'Loading…'}</code>
                  </div>
                  <div>
                    <span>Web research</span>
                    <code>{status?.webSearch ?? 'Anthropic web search'}</code>
                  </div>
                  <div>
                    <span>Active investigations</span>
                    <code>{active}</code>
                  </div>
                </div>
                <div className="setup-instructions">
                  <h4>
                    <Terminal size={15} />
                    Server-side configuration
                  </h4>
                  <p>
                    Add your key to the project’s <code>.env</code> file and restart the server.
                    Your key stays on the server.
                  </p>
                  <div className="code-block">
                    <code>ANTHROPIC_API_KEY=your-key-here</code>
                    <button
                      className="icon-button"
                      title="Copy configuration variable"
                      onClick={() => {
                        navigator.clipboard
                          .writeText('ANTHROPIC_API_KEY=your-key-here')
                          .then(() => {
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                          })
                          .catch(() => notify('Copy the variable from the example.'));
                      }}
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>
                <button
                  className="button primary full-width"
                  onClick={() => {
                    api<ApiStatus>('/api/status')
                      .then((s) => {
                        setStatus(s);
                        notify(
                          s.configured
                            ? 'Claude is connected and ready.'
                            : 'API key is not configured. Add it to .env and restart the server.',
                        );
                      })
                      .catch((e) => notify(e.message));
                  }}
                >
                  <RefreshCw size={15} />
                  Check connection
                </button>
                <button
                  className="text-button sample-modal-link"
                  onClick={() => sample && openRun(sample)}
                >
                  Explore the research sample <ArrowUpRight size={14} />
                </button>
              </>
            ) : (
              <>
                <div className="search-modal-input">
                  <Search size={22} />
                  <input
                    id="modal-title"
                    aria-label="Search workspace"
                    autoFocus
                    placeholder="Search signals, companies, investigations…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <kbd>ESC</kbd>
                </div>
                <div className="search-results">
                  <div className="nav-caption">SIGNALS & COMPANIES</div>
                  {signals.slice(0, 5).map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        setModal(null);
                        setSelectedSignal(s);
                      }}
                    >
                      <Radar size={17} />
                      <div>
                        <strong>{s.title}</strong>
                        <small>
                          {s.sector} · {s.sourceCount} sources
                        </small>
                      </div>
                      <ArrowUpRight size={15} />
                    </button>
                  ))}
                  <div className="nav-caption">INVESTIGATIONS</div>
                  {runs
                    .filter((r) =>
                      `${r.title} ${r.query}`.toLowerCase().includes(search.toLowerCase()),
                    )
                    .slice(0, 4)
                    .map((r) => (
                      <button key={r.id} onClick={() => openRun(r)}>
                        <Network size={17} />
                        <div>
                          <strong>{r.title}</strong>
                          <small>{readable(r.status)}</small>
                        </div>
                        <ArrowUpRight size={15} />
                      </button>
                    ))}
                  {sample && (
                    <button onClick={() => openRun(sample)}>
                      <BookOpen size={17} />
                      <div>
                        <strong>Explore the research sample</strong>
                        <small>Curated cited research · not a live run</small>
                      </div>
                      <ArrowUpRight size={15} />
                    </button>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
      {selectedSignal && (
        <div className="modal-backdrop" onClick={() => setSelectedSignal(null)}>
          <section
            className="modal signal-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="signal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="icon-button modal-close"
              title="Close signal"
              onClick={() => setSelectedSignal(null)}
            >
              <X size={19} />
            </button>
            <div className="eyebrow">
              {selectedSignal.sector} <span>/</span> SIGNAL BRIEF
            </div>
            <h2 id="signal-title">{selectedSignal.title}</h2>
            <p>{selectedSignal.summary}</p>
            <div className="signal-brief-meta">
              <span>Event: {dateLabel(selectedSignal.date)}</span>
              <span>{selectedSignal.sourceCount} sources</span>
              <span>{readable(selectedSignal.confidence)} confidence</span>
            </div>
            <div className="brief-section">
              <h4>Why this matters</h4>
              <p>{selectedSignal.whyNow}</p>
            </div>
            <div className="brief-section">
              <h4>The causal thesis</h4>
              <div className="brief-chain">
                {selectedSignal.causalChain.map((link, i) => (
                  <div key={i}>
                    <span>0{i + 1}</span>
                    <p>
                      {link.label}
                      <small>{link.status}</small>
                    </p>
                  </div>
                ))}
              </div>
            </div>
            <div className="brief-section">
              <h4>Companies to investigate</h4>
              {selectedSignal.companies.map((c) => (
                <button
                  className="brief-company"
                  key={c.id}
                  onClick={() => prepareResearch(selectedSignal, c)}
                >
                  <span className="company-avatar">{c.name[0]}</span>
                  <div>
                    <strong>{c.name}</strong>
                    <p>{c.description}</p>
                  </div>
                  <ArrowUpRight size={17} />
                </button>
              ))}
            </div>
            <div className="uncertainty-box">
              <AlertTriangle size={17} />
              <div>
                <strong>What remains uncertain</strong>
                <p>{selectedSignal.uncertainty}</p>
              </div>
            </div>
            <div className="signal-modal-actions">
              <button
                className="button ghost"
                onClick={() => openSources(selectedSignal.evidenceIds, evidence)}
              >
                <BookOpen size={15} />
                Inspect sources
              </button>
              <button
                className="button primary"
                onClick={() => prepareResearch(selectedSignal, selectedSignal.companies[0])}
              >
                Investigate this signal <ArrowUpRight size={15} />
              </button>
            </div>
          </section>
        </div>
      )}
      {sourceDrawer && (
        <div className="drawer-backdrop" onClick={() => setSourceDrawer(null)}>
          <aside className="source-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-heading">
              <div>
                <div className="eyebrow">TRACE EVERY CLAIM</div>
                <h2>
                  Evidence library{' '}
                  <span>
                    {
                      sourceDrawer.evidence.filter(
                        (e) => !sourceDrawer.ids?.length || sourceDrawer.ids.includes(e.id),
                      ).length
                    }
                  </span>
                </h2>
              </div>
              <button
                className="icon-button"
                title="Close evidence library"
                onClick={() => setSourceDrawer(null)}
              >
                <X size={21} />
              </button>
            </div>
            <p className="drawer-intro">
              Original sources, explicit provenance and the limits of what we know.
            </p>
            <div className="drawer-filters">
              <select
                aria-label="Filter evidence status"
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
              >
                {['All sources', 'SUPPORTED', 'PARTIAL', 'UNVERIFIED', 'CONTRADICTED'].map((s) => (
                  <option key={s} value={s}>
                    {readable(s)}
                  </option>
                ))}
              </select>
              {sourceDrawer.ids?.length ? (
                <button
                  className="text-button"
                  onClick={() => setSourceDrawer({ ...sourceDrawer, ids: undefined })}
                >
                  Show all sources
                </button>
              ) : null}
            </div>
            <div className="drawer-evidence-list">
              {sourceDrawer.evidence
                .filter(
                  (e) =>
                    (!sourceDrawer.ids?.length || sourceDrawer.ids.includes(e.id)) &&
                    (sourceFilter === 'All sources' || e.status === sourceFilter),
                )
                .map((e, i) => (
                  <article className="evidence-card" key={e.id}>
                    <div className="evidence-card-meta">
                      <span>
                        {String(i + 1).padStart(2, '0')} / {readable(e.type)}
                      </span>
                      <span
                        className={`badge ${e.status === 'SUPPORTED' ? 'green' : e.status === 'CONTRADICTED' ? 'rose' : ''}`}
                      >
                        {readable(e.status)}
                      </span>
                    </div>
                    <h3>
                      <a href={e.url} target="_blank" rel="noopener noreferrer">
                        {e.title}
                        <ArrowUpRight size={15} />
                      </a>
                    </h3>
                    <strong className="evidence-publisher">{e.publisher}</strong>
                    <p>{e.summary}</p>
                    <div className="evidence-claim">
                      <small>SUPPORTS THE CLAIM</small>
                      {e.claim}
                    </div>
                    <div className="evidence-dates">
                      <span>Published {dateLabel(e.publishedAt)}</span>
                      <span>Retrieved {dateLabel(e.retrievedAt)}</span>
                    </div>
                    <a
                      className="text-button evidence-original"
                      href={e.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Read original source <ExternalLink size={13} />
                    </a>
                  </article>
                ))}
            </div>
            <div className="drawer-footer">
              <ShieldCheck size={15} />
              Primary sources and company claims are distinguished.
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  detail,
  variant,
}: {
  label: string;
  value: string;
  detail: string;
  variant: number;
}) {
  return (
    <div className="metric-card">
      <span className="metric-label">{label}</span>
      <div className="metric-value">
        {value}
        <MiniVisual variant={variant} />
      </div>
      <span className="metric-detail">
        <span className="tiny-diamond" />
        {detail}
      </span>
    </div>
  );
}
function SignalCard({
  signal,
  index,
  onOpen,
  onResearch,
}: {
  signal: Signal;
  index: number;
  onOpen: () => void;
  onResearch: () => void;
}) {
  return (
    <article className={`panel signal-card signal-${index % 3}`}>
      <button className="signal-card-content" onClick={onOpen}>
        <div className="signal-card-top">
          <span className="sector-label">
            <span className="sector-dot" />
            {signal.sector}
          </span>
          <ArrowUpRight size={17} />
        </div>
        <div className="signal-date">
          SIGNAL 0{index + 1}
          <span>{dateLabel(signal.date)}</span>
        </div>
        <h3>{signal.title}</h3>
        <p>{signal.summary}</p>
        <div className="signal-metadata">
          <span>
            <BookOpen size={12} />
            {signal.sourceCount} sources
          </span>
          <span className="confidence-label">{readable(signal.confidence)} confidence</span>
        </div>
      </button>
      <div className="signal-card-footer">
        <div className="signal-company-group">
          {signal.companies.slice(0, 3).map((c, i) => (
            <span key={c.id} className={`small-company-logo color-${i}`} title={c.name}>
              {c.name.slice(0, 1)}
            </span>
          ))}
          <span>{signal.companies.length} potential beneficiaries</span>
        </div>
        <button onClick={onResearch} title={`Investigate ${signal.title}`}>
          <ArrowRight size={16} />
        </button>
      </div>
    </article>
  );
}
