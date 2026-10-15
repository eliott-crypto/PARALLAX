import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Radar,
  Network,
  Telescope,
  Search,
  Settings2,
  ChevronDown,
  Plus,
  ArrowUpRight,
  ArrowRight,
  ExternalLink,
  X,
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
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  AlertTriangle,
  Terminal,
  Copy,
  Orbit,
  Layers3,
} from 'lucide-react';
import type {
  ApiStatus,
  RadarData,
  Signal,
  Investigation,
  Evidence,
  Company,
} from '../shared/types';
import {
  api,
  post,
  dateLabel,
  readable,
  sourceCount,
  OUTPUT_MODE,
  OUTPUT_MESSAGE,
} from './lib/api';
import { Brand, CausalMap, OrbitGraphic } from './components/Visuals';
import InvestigationRoom from './components/InvestigationRoom';
import ThemeBoardView from './components/ThemeBoard';
import { ThesisUniverse } from './components/ThesisUniverse';
import type { ThemeBoard, BoardCandidate } from '../shared/boards';
import { DomainIdentity } from './components/Identity';
import {
  summarizeSourceHistory,
  sourceName,
  publicSourceDomain,
  SOURCE_HISTORY_EXPLANATION,
} from './lib/source-intelligence';

type Page = 'Themes' | 'Universe' | 'Research';
const NAV = [
  { name: 'Themes', description: 'Your Top 5 opportunities', icon: Layers3 },
  { name: 'Universe', description: 'See conviction & fragility', icon: Orbit },
  { name: 'Research', description: 'Deep investigations', icon: Network },
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
  const [page, setPage] = useState<Page>('Themes');
  const [outputArtifacts, setOutputArtifacts] = useState<Record<string, string>>({});
  const [boards, setBoards] = useState<ThemeBoard[]>([]);
  const [boardsLoading, setBoardsLoading] = useState(true);
  const [boardBusy, setBoardBusy] = useState(false);
  const [activeBoardId, setActiveBoardId] = useState<string>();
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>();
  const [universeBoardId, setUniverseBoardId] = useState<string>();
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [radar, setRadar] = useState<RadarData | null>(null);
  const [runs, setRuns] = useState<Investigation[]>([]);
  const [current, setCurrent] = useState<Investigation | null>(null);
  const [returnBoardId, setReturnBoardId] = useState<string>();
  const [sample, setSample] = useState<Investigation | null>(null);
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState('All sectors');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<'research' | 'settings' | 'search' | 'challenge' | null>(null);
  const [challengeClaim, setChallengeClaim] = useState('');
  const [challengeLoading, setChallengeLoading] = useState(false);
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [company, setCompany] = useState<Company | undefined>();
  const [pendingSignalId, setPendingSignalId] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const workspaceRefresh = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4000);
  }, []);
  const refreshWorkspace = useCallback(async () => {
    const generation = ++workspaceRefresh.current;
    const startedAt = Date.now();
    const baseline = new Map(runsRef.current.map((run) => [run.id, run]));
    const [runResult, statusResult, boardResult] = await Promise.allSettled([
      api<Investigation[]>('/api/investigations'),
      api<ApiStatus>('/api/status'),
      api<ThemeBoard[]>('/api/boards'),
    ]);
    if (generation !== workspaceRefresh.current) return;
    if (statusResult.status === 'fulfilled') setStatus(statusResult.value);
    if (boardResult.status === 'fulfilled')
      setBoards((previous) => [
        ...previous.filter(
          (board) =>
            Date.parse(board.createdAt) >= startedAt &&
            !boardResult.value.some((incoming) => incoming.id === board.id),
        ),
        ...boardResult.value.map((incoming) => {
          const local = previous.find((board) => board.id === incoming.id);
          return local && Date.parse(local.updatedAt) > Date.parse(incoming.updatedAt)
            ? local
            : incoming;
        }),
      ]);
    setBoardsLoading(false);
    if (runResult.status === 'fulfilled') {
      setRuns((previous) => {
        const localById = new Map(previous.map((run) => [run.id, run]));
        const refreshed = runResult.value.map((incoming) => {
          const local = localById.get(incoming.id);
          if (!local || local === baseline.get(incoming.id)) return incoming;
          // An SSE event or local action may arrive after this request started.
          const timestamp = (run: Investigation) =>
            Date.parse(run.completedAt ?? run.events.at(-1)?.timestamp ?? run.createdAt) || 0;
          return timestamp(local) >= timestamp(incoming) ? local : incoming;
        });
        const receivedIds = new Set(refreshed.map((run) => run.id));
        const justStarted = previous.filter(
          (run) => !receivedIds.has(run.id) && Date.parse(run.createdAt) >= startedAt,
        );
        return [...justStarted, ...refreshed];
      });
    }
  }, []);
  const hasActiveResearch =
    runs.some((run) => run.status === 'running') ||
    boards.some((board) => board.status === 'running') ||
    !!status?.activeRuns;
  useEffect(() => {
    if (OUTPUT_MODE || !hasActiveResearch) return;
    const interval = setInterval(() => void refreshWorkspace(), 4_000);
    return () => clearInterval(interval);
  }, [hasActiveResearch, refreshWorkspace]);
  useEffect(() => {
    void refreshWorkspace();
    if (OUTPUT_MODE)
      void api<{ artifacts: Record<string, string> }>('/api/output')
        .then((output) => setOutputArtifacts(output.artifacts))
        .catch(() => {});
    const linkedRunId = new URLSearchParams(window.location.hash.slice(1)).get('investigation');
    const linkedThemeId = new URLSearchParams(window.location.hash.slice(1)).get('theme');
    if (new URLSearchParams(window.location.hash.slice(1)).get('view') === 'universe') {
      setPage('Universe');
      setUniverseBoardId(linkedThemeId ?? undefined);
    }
    if (linkedThemeId && linkedThemeId.length <= 200) {
      setActiveBoardId(linkedThemeId);
      setSelectedCandidateId(
        new URLSearchParams(window.location.hash.slice(1)).get('company') ?? undefined,
      );
    }
    if (linkedRunId && linkedRunId.length <= 200) {
      api<Investigation>(`/api/investigations/${encodeURIComponent(linkedRunId)}`)
        .then((run) => {
          if (
            new URLSearchParams(window.location.hash.slice(1)).get('investigation') === linkedRunId
          )
            openRun(run);
        })
        .catch(() =>
          notify('This saved investigation is unavailable. Explore your research history.'),
        );
    }
    Promise.allSettled([api<RadarData>('/api/radar'), api<Investigation>('/api/sample')]).then(
      (results) => {
        const [b, d] = results;
        if (b.status === 'fulfilled') setRadar(b.value);
        else setError(b.reason.message);
        if (d.status === 'fulfilled') setSample(d.value);
        setLoading(false);
      },
    );
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
  }, [refreshWorkspace, notify]);
  useEffect(() => {
    if (page === 'Universe') {
      const params = new URLSearchParams({ view: 'universe' });
      if (universeBoardId) params.set('theme', universeBoardId);
      window.history.replaceState(null, '', `#${params}`);
      return;
    }
    if (page !== 'Themes' || !activeBoardId) return;
    const params = new URLSearchParams({ theme: activeBoardId });
    if (selectedCandidateId) params.set('company', selectedCandidateId);
    window.history.replaceState(null, '', `#${params}`);
  }, [page, activeBoardId, selectedCandidateId, universeBoardId]);
  useEffect(() => {
    if (OUTPUT_MODE || !current || current.status !== 'running') return;
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
        void refreshWorkspace();
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
  }, [current?.id, current?.status, notify, refreshWorkspace]);
  function navigate(next: Page) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    setPage(next);
    setCurrent(null);
    setActiveBoardId(undefined);
    setSelectedCandidateId(undefined);
    setSearch('');
    setMobileNav(false);
    void refreshWorkspace();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const receiveBoard = (board: ThemeBoard) =>
    setBoards((previous) => [board, ...previous.filter((item) => item.id !== board.id)]);
  async function createBoard(
    title: string,
    thesis: string,
    preferredValuationMaxUsd = 100_000_000,
  ) {
    setBoardBusy(true);
    try {
      const board = await post<ThemeBoard>('/api/boards', {
        title,
        thesis,
        preferredValuationMaxUsd,
      });
      receiveBoard(board);
      setActiveBoardId(board.id);
      setSelectedCandidateId(undefined);
      return board;
    } finally {
      setBoardBusy(false);
    }
  }
  async function reorderBoard(boardId: string, order: string[]) {
    try {
      receiveBoard(
        await api<ThemeBoard>(`/api/boards/${boardId}`, {
          method: 'PATCH',
          body: JSON.stringify({ order }),
        }),
      );
    } catch (error) {
      notify((error as Error).message);
    }
  }
  async function resetBoardOrder(boardId: string) {
    try {
      receiveBoard(
        await api<ThemeBoard>(`/api/boards/${boardId}`, {
          method: 'PATCH',
          body: JSON.stringify({ resetOrder: true }),
        }),
      );
    } catch (error) {
      notify((error as Error).message);
    }
  }
  async function refreshBoard(board: ThemeBoard) {
    try {
      receiveBoard(await post<ThemeBoard>(`/api/boards/${board.id}/refresh`));
    } catch (error) {
      notify((error as Error).message);
    }
  }
  async function investigateCandidate(
    board: ThemeBoard,
    candidate: BoardCandidate,
    challenge: boolean,
  ) {
    try {
      const result = await post<{ board: ThemeBoard; investigation: Investigation }>(
        `/api/boards/${board.id}/candidates/${candidate.companyId}/research`,
        { challenge },
      );
      receiveBoard(result.board);
      setRuns((previous) => [
        result.investigation,
        ...previous.filter((run) => run.id !== result.investigation.id),
      ]);
      openRun(result.investigation, board.id);
      notify(
        challenge
          ? 'Red Team is testing the claim that could break this thesis.'
          : 'A full research team is investigating this company.',
      );
    } catch (error) {
      notify((error as Error).message);
    }
  }
  function openRun(run: Investigation, fromBoardId?: string) {
    setReturnBoardId(fromBoardId);
    window.history.replaceState(null, '', `#${new URLSearchParams({ investigation: run.id })}`);
    setCurrent(run);
    setPage('Research');
    setModal(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function prepareResearch(signal?: Signal, target?: Company) {
    if (OUTPUT_MODE) {
      notify(OUTPUT_MESSAGE);
      return;
    }
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
      setSearch('');
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
  function prepareChallenge() {
    setChallengeClaim(
      current?.agents.find((agent) => agent.id === 'bear')?.output?.disputedClaim ?? '',
    );
    setError('');
    setModal('challenge');
  }
  async function launchChallenge() {
    if (!current || challengeClaim.trim().length < 8) return;
    setChallengeLoading(true);
    setError('');
    try {
      const updated = await post<Investigation>(`/api/investigations/${current.id}/challenge`, {
        claim: challengeClaim,
      });
      setRuns((previous) => [updated, ...previous.filter((run) => run.id !== updated.id)]);
      openRun(updated);
      notify(
        'Fresh verification started. The thesis and assessment will incorporate its findings.',
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setChallengeLoading(false);
    }
  }
  async function finishAssessment() {
    if (!current) return;
    try {
      const updated = await post<Investigation>(`/api/investigations/${current.id}/complete`);
      setRuns((previous) => [updated, ...previous.filter((run) => run.id !== updated.id)]);
      openRun(updated);
      notify('Completed research preserved. The committee is finishing your assessment.');
    } catch (error) {
      notify((error as Error).message);
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
  const sourceHistory = summarizeSourceHistory(runs, evidence).sort(
    (a, b) => b.corrected - a.corrected || b.investigationCount - a.investigationCount,
  );
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
  const latestActive = runs.find((run) => run.status === 'running');
  const shownRuns = runs.filter((r) =>
    `${r.title} ${r.query}`.toLowerCase().includes(search.toLowerCase()),
  );
  const heroSignal = signals[0] ?? radar?.signals[0];
  const openSources = (ids?: string[], ev: Evidence[] = current?.evidence ?? evidence) => {
    setSourceDrawer({
      evidence: Array.from(new Map(ev.map((entry) => [entry.id, entry])).values()),
      ids,
    });
    setSourceFilter('All sources');
  };
  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
        <div className="sidebar-brand">
          <Brand />
          <button
            className="icon-button sidebar-collapse"
            onClick={() => {
              if (window.matchMedia('(max-width: 700px)').matches) setMobileNav(false);
              else setSidebarCollapsed((collapsed) => !collapsed);
            }}
            title={
              mobileNav
                ? 'Close navigation'
                : sidebarCollapsed
                  ? 'Expand sidebar'
                  : 'Collapse sidebar'
            }
            aria-label={
              mobileNav
                ? 'Close navigation'
                : sidebarCollapsed
                  ? 'Expand sidebar'
                  : 'Collapse sidebar'
            }
            aria-expanded={mobileNav || !sidebarCollapsed}
          >
            <PanelLeftClose size={16} className="collapse-sidebar-icon" />
            <PanelLeftOpen size={16} className="expand-sidebar-icon" />
          </button>
        </div>
        <div className="nav-caption">YOUR RESEARCH</div>
        <nav>
          {NAV.map(({ name, description, icon: Icon }) => (
            <button
              key={name}
              className={`nav-item ${page === name ? 'active' : ''}`}
              onClick={() => navigate(name)}
              title={name}
              aria-label={name}
            >
              <span className="nav-icon">
                <Icon size={18} strokeWidth={1.5} />
              </span>
              <span className="nav-label">
                <strong>{name}</strong>
                <small className="nav-description">{description}</small>
              </span>
              {name === 'Research' && active > 0 && <span className="nav-count">{active}</span>}
              {name === 'Universe' && boards.some((board) => board.candidates.length > 0) && (
                <span className="nav-count">
                  {boards.reduce((total, board) => total + board.candidates.length, 0)}
                </span>
              )}
            </button>
          ))}
        </nav>
      </aside>
      {mobileNav && <div className="nav-overlay" onClick={() => setMobileNav(false)} />}
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-logo"
              aria-label={mobileNav ? 'Close navigation' : 'Open navigation'}
              onClick={() => setMobileNav(!mobileNav)}
            >
              <Brand compact />
            </button>
            <Globe2 size={19} strokeWidth={1.4} />
            <span>{current ? 'Investigation room' : page}</span>
          </div>
          <div className="topbar-right">
            <button
              className="global-search"
              aria-label="Search workspace"
              onClick={() => setModal('search')}
            >
              <Search size={17} />
              <span>Search anything</span>
              <kbd>⌘ K</kbd>
            </button>
            <span className="connection-pill">
              <span className={`status-dot ${status?.configured ? 'connected' : ''}`} />
              {OUTPUT_MODE
                ? 'Recorded public output'
                : !status
                  ? 'Connecting…'
                  : status.configured
                    ? 'Claude connected'
                    : 'Sample mode'}
            </span>
            <button
              className="topbar-avatar"
              aria-label="Research settings"
              onClick={() => setModal('settings')}
            >
              <Settings2 size={18} />
            </button>
          </div>
        </header>
        <div className="main-content">
          {OUTPUT_MODE && (
            <div className="config-notice" style={{ marginBottom: 22 }}>
              <Info size={17} />
              <span>
                <strong>Real research, published as a browsable snapshot.</strong> Explore sources,
                the team’s reasoning and the Universe. Reordering and saving stay in this browser;
                new Claude research runs in the local app.
                {(outputArtifacts.pitch || outputArtifacts.proof) && (
                  <span style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                    {outputArtifacts.pitch && (
                      <a href={outputArtifacts.pitch} target="_blank" rel="noreferrer">
                        Open pitch deck{' '}
                        <ArrowUpRight size={12} style={{ verticalAlign: 'middle' }} />
                      </a>
                    )}
                    {outputArtifacts.proof && (
                      <a href={outputArtifacts.proof} download>
                        Download run proof{' '}
                        <ArrowUpRight size={12} style={{ verticalAlign: 'middle' }} />
                      </a>
                    )}
                  </span>
                )}
              </span>
            </div>
          )}
          {current ? (
            <InvestigationRoom
              key={current.id}
              investigation={current}
              onBack={() => {
                if (returnBoardId) {
                  setCurrent(null);
                  setActiveBoardId(returnBoardId);
                  setPage('Themes');
                } else navigate('Research');
              }}
              onEvidence={(ids) => openSources(ids, current.evidence)}
              onWatch={() => updateWatch(current)}
              onRecheck={() => recheck(current)}
              onCancel={cancel}
              onComplete={finishAssessment}
              onChallenge={prepareChallenge}
            />
          ) : (
            <>
              {page === 'Research' && (
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">DEEP RESEARCH</div>
                    <h1>Behind every conviction.</h1>
                    <p>Inspect the full team, evidence and decision from each investigation.</p>
                  </div>
                  <button
                    className="button primary"
                    disabled={OUTPUT_MODE}
                    title={OUTPUT_MODE ? OUTPUT_MESSAGE : undefined}
                    onClick={() => prepareResearch()}
                  >
                    <Plus size={16} />
                    New investigation
                  </button>
                </div>
              )}
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
              {page === 'Themes' && (
                <ThemeBoardView
                  boards={boards}
                  activeBoardId={activeBoardId}
                  selectedCandidateId={selectedCandidateId}
                  loading={boardsLoading}
                  readOnly={OUTPUT_MODE}
                  busy={boardBusy}
                  onSelect={(id) => {
                    setActiveBoardId(id);
                    setSelectedCandidateId(undefined);
                    void refreshWorkspace();
                    if (!id) window.history.replaceState(null, '', window.location.pathname);
                  }}
                  onOpenResearch={(id) => {
                    const run = runs.find((run) => run.id === id);
                    if (run) openRun(run, activeBoardId);
                    else
                      api<Investigation>(`/api/investigations/${id}`)
                        .then((run) => openRun(run, activeBoardId))
                        .catch((error) => notify(error.message));
                  }}
                  onCancel={(board) =>
                    post<ThemeBoard>(`/api/boards/${board.id}/cancel`)
                      .then(receiveBoard)
                      .catch((error) => notify(error.message))
                  }
                  onCreate={createBoard}
                  onComplete={(board) =>
                    post<ThemeBoard>(`/api/boards/${board.id}/complete`)
                      .then(receiveBoard)
                      .catch((error) => notify(error.message))
                  }
                  onReorder={reorderBoard}
                  onResetOrder={(board) => resetBoardOrder(board.id)}
                  onRescan={refreshBoard}
                  onEvidence={(ids, ev) => openSources(ids, ev)}
                  onInvestigate={(candidate, board) =>
                    investigateCandidate(board, candidate, false)
                  }
                  onChallenge={(board, candidate) => investigateCandidate(board, candidate, true)}
                  onOpenUniverse={(board) => {
                    setUniverseBoardId(board.id);
                    setPage('Universe');
                  }}
                />
              )}
              {page === 'Universe' && (
                <ThesisUniverse
                  boards={boards}
                  selectedBoardId={universeBoardId}
                  onSelectBoard={setUniverseBoardId}
                  onOpenCandidate={(boardId, candidateId) => {
                    setActiveBoardId(boardId);
                    setSelectedCandidateId(candidateId);
                    setPage('Themes');
                  }}
                  onInvestigate={() => {
                    setActiveBoardId(undefined);
                    setPage('Themes');
                  }}
                />
              )}
              {page === 'Research' && (
                <>
                  <div className="investigation-toolbar">
                    <div className="tabs">
                      <button className="selected">
                        All investigations
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
                  {shownRuns.length ? (
                    <div className="investigation-list">
                      {shownRuns.map((run) => (
                        <article className="panel investigation-card" key={run.id}>
                          <button className="investigation-card-main" onClick={() => openRun(run)}>
                            <div className="investigation-card-symbol">
                              {run.company ? (
                                <DomainIdentity
                                  url={run.company.website}
                                  name={run.company.name}
                                  size={48}
                                />
                              ) : (
                                <Network size={25} strokeWidth={1.2} />
                              )}
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
                                  {run.mode === 'sample'
                                    ? '9 perspectives illustrated'
                                    : `${run.agents.filter((a) => a.status === 'completed').length}/9 agents completed`}
                                </span>
                                <span>{sourceCount(run.evidence)} cited sources</span>
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
                              {run.watched ? 'Saved' : 'Save thesis'}
                            </button>
                            <button className="text-button" onClick={() => recheck(run)}>
                              <RefreshCw size={13} />
                              Research again
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
                        {false
                          ? 'A PLACE FOR YOUR CONVICTION'
                          : 'RESEARCH WITH A DIFFERENT PERSPECTIVE'}
                      </div>
                      <h2>
                        {search
                          ? 'No matching investigations.'
                          : false
                            ? 'Keep your best theses in view.'
                            : 'Your next thesis starts with a question.'}
                      </h2>
                      <p>
                        {false
                          ? 'Save a completed investigation to follow its assumptions and recheck when the world changes.'
                          : 'Give nine independent agents a signal or a company. Watch them build, challenge and verify the investment case.'}
                      </p>
                      <div className="empty-actions">
                        <button
                          className="button primary"
                          disabled={OUTPUT_MODE}
                          title={OUTPUT_MODE ? OUTPUT_MESSAGE : undefined}
                          onClick={() => prepareResearch()}
                        >
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
            {modal === 'challenge' ? (
              <>
                <div className="modal-icon">
                  <ShieldCheck size={25} />
                </div>
                <div className="eyebrow">CHALLENGE THE THESIS</div>
                <h2 id="modal-title">Which claim needs another look?</h2>
                <p>
                  The Verifier will research this objection, the Bull will revise its position, and
                  the committee will update the assessment. Earlier findings stay in the audit
                  trail.
                </p>
                <label className="field-label" htmlFor="challenge-claim">
                  DISPUTED CLAIM
                </label>
                <textarea
                  id="challenge-claim"
                  autoFocus
                  value={challengeClaim}
                  onChange={(event) => setChallengeClaim(event.target.value)}
                  maxLength={2000}
                  placeholder="e.g. Does the cited customer evidence actually describe this company, or a competitor?"
                />
                <div className="textarea-meta">
                  <span>One additional verification round per investigation.</span>
                  <span>{challengeClaim.length}/2000</span>
                </div>
                {error && (
                  <div className="error-banner">
                    <AlertTriangle size={16} />
                    <span>{error}</span>
                  </div>
                )}
                <button
                  className="button primary full-width"
                  onClick={launchChallenge}
                  disabled={challengeLoading || challengeClaim.trim().length < 8}
                >
                  {challengeLoading ? (
                    <LoaderCircle size={16} className="spinning" />
                  ) : (
                    <ShieldCheck size={16} />
                  )}{' '}
                  {challengeLoading ? 'Starting verification…' : 'Verify and revise thesis'}
                </button>
                <p className="modal-footnote">
                  Uses live research and the investigation’s remaining execution budget.
                </p>
              </>
            ) : modal === 'research' ? (
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
            ) : modal === 'settings' && OUTPUT_MODE ? (
              <>
                <div className="modal-icon">
                  <BookOpen size={24} />
                </div>
                <div className="eyebrow">PUBLIC RESEARCH OUTPUT</div>
                <h2 id="modal-title">A real research snapshot.</h2>
                <p>
                  This public edition presents saved Claude executions, their cited sources and the
                  actual investment debate. It does not run agents or connect to a private API key.
                </p>
                <div className="config-notice">
                  <Info size={17} />
                  <span>
                    Explore themes, company details, the evidence Universe and full research
                    history. Your priority order and saved research stay in this browser.
                  </span>
                </div>
                <p style={{ marginTop: 20 }}>
                  To run new investigations, use the full PARALLAX app with its server-side Claude
                  connection.
                </p>
                <a
                  className="button primary full-width"
                  style={{ marginTop: 20 }}
                  href="https://github.com/eliott-crypto/PARALLAX"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open project and run instructions
                  <ArrowUpRight size={15} />
                </a>
              </>
            ) : modal === 'settings' ? (
              <>
                <div className="modal-icon">
                  <Settings2 size={24} />
                </div>
                <div className="eyebrow">RESEARCH SETTINGS</div>
                <h2 id="modal-title">Claude connection</h2>
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
                {!status?.configured && (
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
                )}
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
                  <div className="nav-caption">THEMES & SHORTLISTS</div>
                  {boards
                    .filter((board) =>
                      `${board.title} ${board.thesis} ${board.candidates.map((candidate) => candidate.company.name).join(' ')}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    )
                    .slice(0, 5)
                    .map((board) => (
                      <button
                        key={board.id}
                        onClick={() => {
                          setCurrent(null);
                          setPage('Themes');
                          setActiveBoardId(board.id);
                          setSelectedCandidateId(undefined);
                          setModal(null);
                        }}
                      >
                        <Layers3 size={17} />
                        <div>
                          <strong>{board.title}</strong>
                          <small>
                            {board.candidates.length}/5 priced startups · {readable(board.status)}
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
              <span>
                {sourceCount(
                  evidence.filter((entry) => selectedSignal.evidenceIds.includes(entry.id)),
                )}{' '}
                sources
              </span>
              <span>{readable(selectedSignal.confidence)} confidence</span>
            </div>
            <div className="brief-section">
              <h4>Read the original sources</h4>
              <div className="source-strip">
                {evidence
                  .filter((entry) => selectedSignal.evidenceIds.includes(entry.id))
                  .map((entry) => (
                    <a
                      className="source-chip"
                      key={entry.id}
                      href={entry.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <DomainIdentity
                        url={entry.url}
                        name={sourceName(entry.url, entry.publisher)}
                        size={36}
                      />
                      <span>
                        <strong>{sourceName(entry.url, entry.publisher)}</strong>
                        <small>{entry.title}</small>
                      </span>
                      <ExternalLink size={15} />
                    </a>
                  ))}
              </div>
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
                  <DomainIdentity url={c.website} name={c.name} size={40} />
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
                  Sources{' '}
                  <span>
                    {
                      sourceDrawer.evidence.filter(
                        (e) => !sourceDrawer.ids?.length || sourceDrawer.ids.includes(e.id),
                      ).length
                    }{' '}
                    records
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
              {sourceCount(
                sourceDrawer.evidence.filter(
                  (entry) => !sourceDrawer.ids?.length || sourceDrawer.ids.includes(entry.id),
                ),
              )}{' '}
              distinct sources. Individual evidence records preserve each claim and its provenance.
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
                    <div className="evidence-publisher">
                      <DomainIdentity url={e.url} name={sourceName(e.url, e.publisher)} size={34} />
                      <strong>{sourceName(e.url, e.publisher)}</strong>
                    </div>
                    <p>{e.summary}</p>
                    <div className="evidence-claim">
                      <small>CLAIM ASSESSED BY THE RESEARCH TEAM</small>
                      {e.claim}
                    </div>
                    {e.correction && (
                      <div className="uncertainty-box source-correction">
                        <ShieldCheck size={17} />
                        <div>
                          <strong>Corrected after verification</strong>
                          <p>{e.correction}</p>
                        </div>
                      </div>
                    )}
                    <div className="evidence-dates">
                      <span>Reported publication {dateLabel(e.publishedAt)}</span>
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
