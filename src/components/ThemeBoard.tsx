import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleDot,
  ExternalLink,
  FlaskConical,
  Globe2,
  Layers3,
  LoaderCircle,
  Plus,
  Radar,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Swords,
  Target,
  TrendingUp,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { BoardCandidate, ThemeBoard } from '../../shared/boards';
import type { Evidence } from '../../shared/types';
import { DomainIdentity } from './Identity';
import { publicSourceDomain, sourceName } from '../lib/source-intelligence';
import './ThemeBoard.css';

export interface ThemeBoardViewProps {
  boards: ThemeBoard[];
  activeBoardId?: string;
  selectedCandidateId?: string;
  loading?: boolean;
  busy?: boolean;
  onSelect: (id?: string) => void;
  onCreate: (title: string, thesis: string) => Promise<unknown> | void;
  onReorder: (boardId: string, companyIds: string[]) => Promise<unknown> | void;
  onInvestigate: (candidate: BoardCandidate, board: ThemeBoard) => Promise<unknown> | void;
  onEvidence: (ids: string[], evidence: Evidence[]) => void;
  onOpenUniverse: (board: ThemeBoard) => void;
  onOpenResearch?: (id: string) => void;
  onChallenge?: (board: ThemeBoard, candidate: BoardCandidate) => Promise<unknown> | void;
  onRescan?: (board: ThemeBoard) => Promise<unknown> | void;
  onCancel?: (board: ThemeBoard) => Promise<unknown> | void;
  onResetOrder?: (board: ThemeBoard) => Promise<unknown> | void;
}

const EXAMPLES = [
  {
    title: 'AI browser infrastructure',
    thesis:
      'Find private startups building browsers and sandboxes for AI agents. Compare disclosed financing valuations, developer traction and defensibility.',
  },
  {
    title: 'Space infrastructure',
    thesis:
      'Find private startups building space infrastructure, from orbital data centres to launch and satellite platforms. Prioritise sourced, disclosed valuations and commercial evidence.',
  },
  {
    title: 'Cybersecurity',
    thesis:
      'Find private cybersecurity startups protecting software supply chains and AI workloads. Compare disclosed financing valuations with verified customer and product signals.',
  },
];

export function valuationLabel(amount: number): string {
  if (amount >= 1e9)
    return `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(amount / 1e9)}B`;
  if (amount >= 1e6)
    return `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(amount / 1e6)}M`;
  return `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(amount)}`;
}

function valuationDate(value: string) {
  const date = new Date(`${value.length === 7 ? `${value}-01` : value}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function sourceList(evidence: Evidence[], ids?: string[]): Evidence[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    if (ids && !ids.includes(item.id)) return false;
    const domain = publicSourceDomain(item.url);
    if (!domain || seen.has(domain)) return false;
    seen.add(domain);
    return true;
  });
}

function BoardStatus({ board }: { board: ThemeBoard }) {
  const text =
    board.status === 'draft'
      ? 'Ready to research'
      : board.status === 'running'
        ? 'Agents researching'
        : board.status === 'completed'
          ? 'Research complete'
          : board.status === 'partial'
            ? 'Partial research'
            : board.status === 'cancelled'
              ? 'Stopped'
              : 'Needs attention';
  return (
    <span className={`tb-status ${board.status}`}>
      <i />
      {text}
    </span>
  );
}

function SourceRow({ evidence, onClick }: { evidence: Evidence; onClick: () => void }) {
  return (
    <button className="tb-source-row" onClick={onClick}>
      <DomainIdentity
        url={evidence.url}
        name={sourceName(evidence.url, evidence.publisher)}
        size={28}
      />
      <span>
        <strong>{sourceName(evidence.url, evidence.publisher)}</strong>
        <small>{evidence.title}</small>
      </span>
      <ArrowUpRight size={13} />
    </button>
  );
}

function ResearchProgress({ board }: { board: ThemeBoard }) {
  const completed = board.agents.filter((agent) => agent.status === 'completed').length;
  const running = board.agents.filter((agent) => agent.status === 'running');
  const searches = board.agents.reduce((total, agent) => total + agent.searches, 0);
  const lastEvent = board.events.at(-1);
  return (
    <section className="tb-running" aria-live="polite">
      <div className="tb-eyebrow">
        <LoaderCircle size={14} className="tb-spin" /> Live Claude team · {completed}/
        {board.agents.length} stages complete
      </div>
      <h3>
        {running.length
          ? running.map((agent) => agent.name).join(' + ')
          : 'Preparing the next research stage'}
      </h3>
      <p>
        Two scouts search independently. A valuation specialist checks the price, a sceptic
        challenges the thesis, and a final agent builds your shortlist.
      </p>
      <div className="tb-progress-stages">
        {board.agents.map((agent) => (
          <span
            key={agent.id}
            className={
              agent.status === 'completed' ? 'done' : agent.status === 'running' ? 'current' : ''
            }
            title={`${agent.name}: ${agent.status}`}
          />
        ))}
      </div>
      <div className="tb-event">
        <Radar size={13} />
        <span>
          {searches} real web searches
          {lastEvent ? ` · ${lastEvent.message}` : ' · Waiting for the first agent event.'}
        </span>
      </div>
    </section>
  );
}

function CreateTheme({
  busy,
  onClose,
  onCreate,
}: {
  busy?: boolean;
  onClose: () => void;
  onCreate: ThemeBoardViewProps['onCreate'];
}) {
  const [title, setTitle] = useState('');
  const [thesis, setThesis] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  return (
    <div className="tb-dialog-backdrop" onClick={onClose}>
      <section
        className="tb-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Create a research theme"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="tb-dialog-close" onClick={onClose} aria-label="Close new theme">
          <X size={17} />
        </button>
        <div className="tb-eyebrow">
          <Layers3 size={14} /> New research theme
        </div>
        <h2>What is your next conviction?</h2>
        <p>
          Give the agents a market to explore. They will look for private companies with disclosed
          valuations, then argue about which deserve your attention.
        </p>
        <form
          className="tb-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (title.trim().length < 3 || thesis.trim().length < 10) return;
            setSubmitting(true);
            setError('');
            try {
              await onCreate(title.trim(), thesis.trim());
              onClose();
            } catch (reason) {
              setError(
                reason instanceof Error
                  ? reason.message
                  : 'The theme could not be created. Please try again.',
              );
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <label htmlFor="tb-theme-title">Theme</label>
          <input
            ref={titleRef}
            id="tb-theme-title"
            maxLength={100}
            minLength={3}
            placeholder="e.g. AI browser infrastructure"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
          <label htmlFor="tb-theme-thesis">Your thesis or research question</label>
          <textarea
            id="tb-theme-thesis"
            maxLength={700}
            minLength={10}
            value={thesis}
            onChange={(event) => setThesis(event.target.value)}
            placeholder="Which companies benefit, and what would make their disclosed valuation compelling?"
            required
          />
          <div className="tb-examples">
            {EXAMPLES.map((example) => (
              <button
                type="button"
                key={example.title}
                onClick={() => {
                  setTitle(example.title);
                  setThesis(example.thesis);
                }}
              >
                {example.title}
              </button>
            ))}
          </div>
          {error && (
            <div className="tb-error">
              <TriangleAlert size={15} />
              {error}
            </div>
          )}
          <button className="tb-button primary" disabled={busy || submitting} type="submit">
            {submitting ? <LoaderCircle size={15} className="tb-spin" /> : <Sparkles size={15} />}
            Build my Top 5<ArrowRight size={15} />
          </button>
        </form>
      </section>
    </div>
  );
}

function CandidateDetail({
  board,
  candidate,
  index,
  onClose,
  onEvidence,
  onInvestigate,
  onChallenge,
  onOpenResearch,
  busy,
}: {
  board: ThemeBoard;
  candidate: BoardCandidate;
  index: number;
  onClose: () => void;
  onEvidence: ThemeBoardViewProps['onEvidence'];
  onInvestigate: ThemeBoardViewProps['onInvestigate'];
  onChallenge: ThemeBoardViewProps['onChallenge'];
  onOpenResearch: ThemeBoardViewProps['onOpenResearch'];
  busy?: boolean;
}) {
  const evidence = board.evidence.filter(
    (item) =>
      candidate.evidenceIds.includes(item.id) ||
      candidate.valuation.evidenceIds.includes(item.id) ||
      Boolean(candidate.latestReview?.evidenceIds.includes(item.id)),
  );
  const sources = sourceList(evidence);
  return (
    <div className="tb-dialog-backdrop" onClick={onClose}>
      <section
        className="tb-dialog tb-detail"
        role="dialog"
        aria-modal="true"
        aria-label={`${candidate.company.name} investment research`}
        onClick={(event) => event.stopPropagation()}
      >
        <button className="tb-dialog-close" onClick={onClose} aria-label="Close company details">
          <X size={17} />
        </button>
        <div className="tb-eyebrow">
          #{index + 1} in your shortlist · {candidate.confidence.toLowerCase()} confidence
        </div>
        <div className="tb-detail-top">
          <DomainIdentity url={candidate.company.website} name={candidate.company.name} size={57} />
          <div>
            <h2>{candidate.company.name}</h2>
            <a href={candidate.company.website} target="_blank" rel="noreferrer">
              {publicSourceDomain(candidate.company.website)}
              <ExternalLink size={11} />
            </a>
          </div>
        </div>
        <p className="tb-detail-description">{candidate.company.description}</p>
        {candidate.latestReview && (
          <section className="tb-review">
            <div className="tb-eyebrow">
              <ShieldCheck size={14} />
              Nine-agent follow-up ·{' '}
              {new Date(candidate.latestReview.checkedAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </div>
            <h3>
              {candidate.latestReview.decision?.replaceAll('_', ' ') || 'Research reviewed'}
              <span>{candidate.latestReview.confidence.toLowerCase()} confidence</span>
            </h3>
            {candidate.latestReview.verification && (
              <div className="tb-review-result">
                Claim check: {candidate.latestReview.verification.toLowerCase()}
              </div>
            )}
            <p>{candidate.latestReview.summary}</p>
            <div className="tb-actions">
              {onOpenResearch && (
                <button
                  className="tb-button small"
                  onClick={() => {
                    onClose();
                    onOpenResearch(candidate.latestReview!.investigationId);
                  }}
                >
                  Open full follow-up
                  <ArrowUpRight size={12} />
                </button>
              )}
              {candidate.latestReview.evidenceIds.length > 0 && (
                <button
                  className="tb-button small"
                  onClick={() => onEvidence(candidate.latestReview!.evidenceIds, board.evidence)}
                >
                  Review checked evidence
                  <ShieldCheck size={12} />
                </button>
              )}
            </div>
            <small>
              The shortlist below reflects its original comparison. Refresh the theme to rerank all
              companies using the latest research.
            </small>
          </section>
        )}
        {!candidate.latestReview && candidate.researchId && onOpenResearch && (
          <button
            className="tb-button small"
            style={{ marginBottom: 12 }}
            onClick={() => {
              onClose();
              onOpenResearch(candidate.researchId!);
            }}
          >
            Open attached research
            <ArrowUpRight size={12} />
          </button>
        )}
        <div className="tb-detail-valuation">
          <div>
            <span>DISCLOSED FINANCING VALUATION</span>
            <strong>{valuationLabel(candidate.valuation.amountUsd)}</strong>
            <span>
              {candidate.valuation.round} · {valuationDate(candidate.valuation.asOf)} ·{' '}
              {candidate.valuation.basis.replaceAll('_', ' ').toLowerCase()}
            </span>
          </div>
          <p>
            {candidate.valuation.label}
            <br />
            <button
              className="tb-button small"
              style={{ marginTop: 10 }}
              onClick={() => onEvidence(candidate.valuation.evidenceIds, board.evidence)}
            >
              Check valuation source
              <ArrowUpRight size={12} />
            </button>
          </p>
        </div>
        <div className="tb-detail-section">
          <h3>Why this company is on the list</h3>
          <p>{candidate.rationale}</p>
        </div>
        <div className="tb-decision-grid">
          <section className="tb-decision">
            <h3>
              <TrendingUp size={15} />
              The case for it
            </h3>
            <p>{candidate.bullCase}</p>
          </section>
          <section className="tb-decision bear">
            <h3>
              <Swords size={15} />
              The strongest objection
            </h3>
            <p>{candidate.bearCase}</p>
          </section>
        </div>
        <div className="tb-detail-section">
          <h3>
            Is the valuation attractive?{' '}
            <span className={`tb-tag ${candidate.priceSignal === 'RELATIVE VALUE' ? '' : 'amber'}`}>
              {candidate.priceSignal.toLowerCase()}
            </span>
          </h3>
          <p>{candidate.priceReason}</p>
        </div>
        <section className="tb-kill">
          <h3>
            <FlaskConical size={16} />
            What would change your mind?
          </h3>
          <p>{candidate.killCriterion}</p>
          <h3>
            <Target size={15} />
            The next piece of proof
          </h3>
          <p>{candidate.nextProof}</p>
          {onChallenge && (
            <button
              disabled={busy || board.status === 'running'}
              className="tb-button small"
              onClick={() => {
                onClose();
                void onChallenge(board, candidate);
              }}
            >
              Send agents to test this
              <Sparkles size={13} />
            </button>
          )}
        </section>
        <div className="tb-detail-section">
          <h3>Read the original evidence</h3>
          {sources.slice(0, 5).map((item) => (
            <SourceRow
              key={item.id}
              evidence={item}
              onClick={() => onEvidence([item.id], board.evidence)}
            />
          ))}
          <button
            className="tb-button small"
            style={{ marginTop: 15 }}
            onClick={() =>
              onEvidence(
                [...candidate.evidenceIds, ...candidate.valuation.evidenceIds],
                board.evidence,
              )
            }
          >
            All {evidence.length} evidence records
            <ArrowUpRight size={12} />
          </button>
        </div>
        <div className="tb-detail-footer">
          <button className="tb-button" onClick={onClose}>
            Back to Top 5
          </button>
          <button
            className="tb-button primary"
            disabled={busy}
            onClick={() => {
              onClose();
              void onInvestigate(candidate, board);
            }}
          >
            <Sparkles size={15} />
            Run the nine-agent deep dive
            <ArrowRight size={14} />
          </button>
        </div>
        <p className="tb-fineprint">
          The valuation is a disclosed historical financing figure, not a live price or available
          offer. Entry terms, share class, access and dilution require separate diligence.
        </p>
      </section>
    </div>
  );
}

export function ThemeBoardView(props: ThemeBoardViewProps) {
  const {
    boards,
    activeBoardId,
    selectedCandidateId,
    loading,
    busy,
    onSelect,
    onCreate,
    onReorder,
    onInvestigate,
    onEvidence,
    onOpenUniverse,
    onOpenResearch,
    onChallenge,
    onRescan,
    onCancel,
    onResetOrder,
  } = props;
  const [creating, setCreating] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const board = boards.find((item) => item.id === activeBoardId);
  const candidates = board
    ? [...board.candidates].sort((a, b) => (a.manualRank ?? a.rank) - (b.manualRank ?? b.rank))
    : [];
  const selected = candidates.find((item) => item.company.id === selectedCompanyId);
  const sourceDomains = board ? sourceList(board.evidence) : [];
  const manual = candidates.some((item) => item.manualRank !== undefined);
  useEffect(() => {
    setSelectedCompanyId(selectedCandidateId || null);
    setActionError('');
  }, [activeBoardId, selectedCandidateId]);
  useEffect(() => {
    if (!creating && !selectedCompanyId) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCreating(false);
        setSelectedCompanyId(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = original;
      document.removeEventListener('keydown', onKey);
    };
  }, [creating, selectedCompanyId]);
  const cancel = async (target: ThemeBoard) => {
    if (!onCancel || cancelling) return;
    setCancelling(target.id);
    setActionError('');
    try {
      await onCancel(target);
    } catch (reason) {
      setActionError(
        reason instanceof Error
          ? reason.message
          : 'Research could not be stopped. Please try again.',
      );
    } finally {
      setCancelling(null);
    }
  };
  const move = async (index: number, direction: -1 | 1) => {
    if (!board || index + direction < 0 || index + direction >= candidates.length) return;
    const ids = candidates.map((item) => item.company.id);
    [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
    setReordering(true);
    setActionError('');
    try {
      await onReorder(board.id, ids);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Your order could not be saved.');
    } finally {
      setReordering(false);
    }
  };
  return (
    <div className="theme-workspace">
      {board ? (
        <>
          <div className="tb-breadcrumb">
            <button onClick={() => onSelect(undefined)}>
              <ArrowLeft size={12} style={{ verticalAlign: 'middle', marginRight: 5 }} />
              All themes
            </button>
            <ChevronRight size={12} />
            <span>{board.title}</span>
          </div>
          <div className="tb-heading">
            <div>
              <div className="tb-eyebrow">
                <Layers3 size={14} /> Your research shortlist
              </div>
              <h1>{board.title}</h1>
              <p>{board.thesis}</p>
              <div className="tb-board-labels">
                <BoardStatus board={board} />
                <span>
                  <ShieldCheck size={11} />
                  Disclosed valuations only
                </span>
                <span>
                  <CircleDot size={11} />
                  {board.mode === 'recorded' ? 'Recorded real research' : 'Live research'}
                </span>
              </div>
            </div>
            <div className="tb-actions">
              <button
                className="tb-button"
                onClick={() => onOpenUniverse(board)}
                disabled={!candidates.length}
              >
                <Globe2 size={16} />
                Conviction Universe
              </button>
              {board.status === 'running' && onCancel && (
                <button
                  className="tb-button tb-stop"
                  disabled={cancelling === board.id}
                  onClick={() => void cancel(board)}
                >
                  {cancelling === board.id ? (
                    <LoaderCircle className="tb-spin" size={14} />
                  ) : (
                    <X size={14} />
                  )}
                  {cancelling === board.id ? 'Stopping…' : 'Stop research'}
                </button>
              )}
              {board.status !== 'running' && onRescan && (
                <button
                  className="tb-button"
                  disabled={busy}
                  onClick={() => onRescan(board)}
                >
                  {board.status === 'draft' ? <Sparkles size={14} /> : <RefreshCw size={14} />}
                  {board.status === 'draft' ? 'Build Top 5' : 'Refresh research'}
                </button>
              )}
            </div>
          </div>
          {board.status === 'running' && <ResearchProgress board={board} />}
          {board.status === 'draft' && (
            <section className="tb-running">
              <div className="tb-eyebrow">
                <Sparkles size={14} />
                Your theme is ready
              </div>
              <h3>Turn this thesis into a sourced Top 5.</h3>
              <p>
                A five-agent team will discover companies, verify their disclosed valuations and
                argue about which deserve a closer look.
              </p>
              {onRescan && (
                <button
                  className="tb-button primary"
                  style={{ marginTop: 20 }}
                  disabled={busy}
                  onClick={() => onRescan(board)}
                >
                  <Sparkles size={15} />
                  Build Top 5<ArrowRight size={14} />
                </button>
              )}
            </section>
          )}
          {board.error && (
            <div className="tb-error">
              <TriangleAlert size={16} />
              <span>{board.error}</span>
            </div>
          )}
          {actionError && (
            <div className="tb-error">
              <TriangleAlert size={15} />
              {actionError}
            </div>
          )}
          <div className="tb-ranking-note">
            <strong>
              Top {candidates.length || 5} ·{' '}
              {manual ? 'Your priority order' : 'Agent research priority'}
            </strong>
            <span>
              {manual && onResetOrder ? (
                <button onClick={() => onResetOrder(board)} style={{ color: '#c6b5f4' }}>
                  Restore agent order
                </button>
              ) : (
                'Compare the price. Challenge the thesis. Make it yours.'
              )}
            </span>
          </div>
          <div className="tb-rank-list">
            {candidates.map((candidate, index) => (
              <article className="tb-candidate" key={candidate.company.id}>
                <div className="tb-rank">{String(index + 1).padStart(2, '0')}</div>
                <button
                  className="tb-candidate-body"
                  onClick={() => setSelectedCompanyId(candidate.company.id)}
                  aria-label={`Explore ${candidate.company.name}`}
                >
                  <div className="tb-company-line">
                    <DomainIdentity
                      url={candidate.company.website}
                      name={candidate.company.name}
                      size={41}
                    />
                    <div>
                      <h3>{candidate.company.name}</h3>
                      <div className="tb-company-domain">
                        {candidate.company.category ||
                          publicSourceDomain(candidate.company.website)}
                      </div>
                    </div>
                  </div>
                  <p className="tb-candidate-why">{candidate.rationale}</p>
                  <div className="tb-candidate-signals">
                    <span
                      className={`tb-tag ${candidate.priceSignal === 'RELATIVE VALUE' ? '' : 'amber'}`}
                    >
                      <TrendingUp size={10} />
                      {candidate.priceSignal.toLowerCase()}
                    </span>
                    <span className="tb-tag violet">
                      <ShieldCheck size={10} />
                      {candidate.confidence.toLowerCase()} confidence
                    </span>
                    {candidate.latestReview ? (
                      <span className="tb-tag">
                        <ShieldCheck size={10} />
                        {candidate.latestReview.verification === 'SUPPORTED'
                          ? 'Verified again'
                          : 'Reviewed again'}
                      </span>
                    ) : candidate.researchId ? (
                      <span className="tb-tag violet">Research attached</span>
                    ) : null}
                    <span className="tb-tag violet">
                      {
                        sourceList(board.evidence, [
                          ...candidate.evidenceIds,
                          ...candidate.valuation.evidenceIds,
                          ...(candidate.latestReview?.evidenceIds || []),
                        ]).length
                      }{' '}
                      sources
                    </span>
                  </div>
                </button>
                <div className="tb-price">
                  <span>Disclosed valuation</span>
                  <strong>{valuationLabel(candidate.valuation.amountUsd)}</strong>
                  <small>
                    {valuationDate(candidate.valuation.asOf)} · {candidate.valuation.round}
                  </small>
                  <button
                    onClick={() => onEvidence(candidate.valuation.evidenceIds, board.evidence)}
                  >
                    See price evidence
                    <ArrowUpRight size={11} />
                  </button>
                </div>
                <div className="tb-rank-controls">
                  <button
                    aria-label={`Move ${candidate.company.name} up`}
                    disabled={index === 0 || reordering || board.status === 'running'}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp size={12} />
                  </button>
                  <button
                    className="tb-list-open"
                    aria-label={`Open ${candidate.company.name} details`}
                    onClick={() => setSelectedCompanyId(candidate.company.id)}
                  >
                    <ArrowUpRight size={17} />
                  </button>
                  <button
                    aria-label={`Move ${candidate.company.name} down`}
                    disabled={
                      index === candidates.length - 1 || reordering || board.status === 'running'
                    }
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown size={12} />
                  </button>
                </div>
              </article>
            ))}
            {Array.from({ length: Math.max(0, 5 - candidates.length) }, (_, index) => (
              <div className="tb-empty-rank" key={`empty-${index}`}>
                <span>{String(candidates.length + index + 1).padStart(2, '0')}</span>
                <span>
                  {board.status === 'draft'
                    ? 'Start the agents to discover a company for this place'
                    : board.status === 'running'
                      ? 'Awaiting verified company and valuation evidence'
                      : 'No additional company cleared the disclosed-valuation research filter'}
                </span>
              </div>
            ))}
          </div>
          <div className="tb-underboard">
            <section className="tb-proof">
              <FlaskConical size={24} />
              <div>
                <div className="tb-eyebrow">Conviction, under pressure</div>
                <h3>A good thesis tells you when it is wrong.</h3>
                <p>
                  Every company has a specific kill criterion. Open a company and ask a fresh Claude
                  team to test the one thing that could break its investment case.
                </p>
                <button
                  className="tb-button small"
                  onClick={() => onOpenUniverse(board)}
                  disabled={!candidates.length}
                >
                  <Globe2 size={14} />
                  See the Conviction Universe
                  <ArrowRight size={13} />
                </button>
              </div>
            </section>
            <section className="tb-sources">
              <h3>Research you can trace</h3>
              {sourceDomains.slice(0, 3).map((item) => (
                <SourceRow
                  key={item.id}
                  evidence={item}
                  onClick={() => onEvidence([item.id], board.evidence)}
                />
              ))}
              {!sourceDomains.length && (
                <p className="tb-fineprint">
                  Original sources will appear as agents retrieve and admit evidence.
                </p>
              )}
              {sourceDomains.length > 0 && (
                <button
                  className="tb-button small"
                  onClick={() =>
                    onEvidence(
                      board.evidence.map((item) => item.id),
                      board.evidence,
                    )
                  }
                >
                  Explore {sourceDomains.length} source domains
                  <ArrowUpRight size={12} />
                </button>
              )}
            </section>
          </div>
          <p className="tb-fineprint">
            {board.rankingMethod ||
              'Rank reflects research priority, based on source-backed signals, relative disclosed valuations and downside risks.'}{' '}
            Financing valuations are historical reference points. Current share price, investment
            access and return potential are not established by this shortlist.
          </p>
        </>
      ) : (
        <>
          <div className="tb-heading">
            <div>
              <div className="tb-eyebrow">
                <Layers3 size={14} /> Your investment themes
              </div>
              <h1>Find your next conviction.</h1>
              <p>
                A focused Top 5 for every market you care about. Real companies, disclosed
                valuations, and agents that challenge each other's investment case.
              </p>
            </div>
            <button className="tb-button primary" onClick={() => setCreating(true)}>
              <Plus size={16} />
              New theme
            </button>
          </div>
          <section className="tb-overview">
            <div>
              <div className="tb-eyebrow">How your Top 5 gets made</div>
              <h2>Scouts discover. Specialists challenge. You decide.</h2>
              <p>
                Five Claude agents compare companies, check disclosed valuations and expose the
                strongest objection to each pick.
              </p>
            </div>
            <div
              className="tb-overview-stages"
              aria-label="Scouts, valuation and challenge, then shortlist"
            >
              <span className="tb-stage-dot">
                <Radar size={20} />
              </span>
              <ArrowRight size={14} />
              <span className="tb-stage-dot">
                <Swords size={20} />
              </span>
              <ArrowRight size={14} />
              <span className="tb-stage-dot">
                <Target size={20} />
              </span>
            </div>
          </section>
          {actionError && (
            <div className="tb-error">
              <TriangleAlert size={15} />
              {actionError}
            </div>
          )}
          {loading ? (
            <div className="tb-loading">
              <LoaderCircle className="tb-spin" size={19} />
              Loading your research themes…
            </div>
          ) : (
            <div className="tb-grid">
              {boards.map((item, index) => (
                <article className="tb-theme" key={item.id}>
                  <button className="tb-theme-main" onClick={() => onSelect(item.id)}>
                    <div className="tb-theme-index">
                      <span>Theme {String(index + 1).padStart(2, '0')}</span>
                      <BoardStatus board={item} />
                    </div>
                    <h2>{item.title}</h2>
                    <p>{item.thesis}</p>
                  </button>
                  <div className="tb-theme-footer">
                    <div className="tb-logo-stack">
                      {item.candidates.slice(0, 4).map((candidate) => (
                        <DomainIdentity
                          key={candidate.company.id}
                          url={candidate.company.website}
                          name={candidate.company.name}
                          size={26}
                        />
                      ))}
                      <span>
                        {item.candidates.length
                          ? `${item.candidates.length} shortlisted`
                          : item.status === 'running'
                            ? 'Building your shortlist'
                            : item.status === 'draft'
                              ? 'Build your Top 5'
                              : 'Research available'}
                      </span>
                    </div>
                    {item.status === 'running' && onCancel && (
                      <button
                        className="tb-button small tb-stop"
                        disabled={cancelling === item.id}
                        onClick={() => void cancel(item)}
                        aria-label={`Stop research for ${item.title}`}
                      >
                        {cancelling === item.id ? (
                          <LoaderCircle className="tb-spin" size={12} />
                        ) : (
                          <X size={12} />
                        )}
                        Stop
                      </button>
                    )}
                    <button
                      aria-label={`View ${item.title} shortlist`}
                      onClick={() => onSelect(item.id)}
                    >
                      <ArrowUpRight size={17} />
                    </button>
                  </div>
                </article>
              ))}
              <button className="tb-new-theme" onClick={() => setCreating(true)}>
                <Plus size={23} />
                <strong>Follow a new theme</strong>
                <span>Start with a market you believe in. Let the agents test the companies.</span>
              </button>
            </div>
          )}
          <p className="tb-fineprint">
            <Check size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            Only private companies with sourced, disclosed financing valuations can make a Top 5.
            Fewer than five may qualify.
          </p>
        </>
      )}
      {creating && (
        <CreateTheme busy={busy} onClose={() => setCreating(false)} onCreate={onCreate} />
      )}
      {board && selected && (
        <CandidateDetail
          board={board}
          candidate={selected}
          index={candidates.findIndex((item) => item.company.id === selected.company.id)}
          onClose={() => setSelectedCompanyId(null)}
          onEvidence={onEvidence}
          onInvestigate={onInvestigate}
          onChallenge={onChallenge}
          onOpenResearch={onOpenResearch}
          busy={busy}
        />
      )}
    </div>
  );
}

export default ThemeBoardView;
