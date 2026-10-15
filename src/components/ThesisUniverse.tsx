import { useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Eye,
  Globe2,
  Minus,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { ThemeBoard } from '../../shared/boards';
import { deriveUniverseNodes, UNIVERSE_COLORS as COLORS } from '../lib/universe';
import { DomainIdentity } from './Identity';
import './ThesisUniverse.css';

export interface ThesisUniverseProps {
  boards: ThemeBoard[];
  selectedBoardId?: string;
  onSelectBoard?: (boardId: string | undefined) => void;
  onOpenCandidate: (boardId: string, candidateId: string) => void;
  onInvestigate?: () => void;
}

const money = (value: number) =>
  value >= 1e9 ? `$${Number((value / 1e9).toFixed(2))}B` : `$${Number((value / 1e6).toFixed(1))}M`;
const sentenceCase = (value: string) => value.toLowerCase().replace(/_/g, ' ');

/** Categorical agent confidence and admitted evidence, never a prediction of returns. */
export function ThesisUniverse({
  boards,
  selectedBoardId,
  onSelectBoard,
  onOpenCandidate,
  onInvestigate,
}: ThesisUniverseProps) {
  const [localFilter, setLocalFilter] = useState<string>('all');
  const filter = selectedBoardId || localFilter;
  const [independentOnly, setIndependentOnly] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string>();
  const [rotation, setRotation] = useState({ yaw: -0.3, pitch: 0.24 });
  const initialZoom = () =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 600px)').matches ? 0.7 : 1;
  const [zoom, setZoom] = useState(initialZoom);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const nodes = useMemo(
    () => deriveUniverseNodes(boards, filter, independentOnly),
    [boards, filter, independentOnly],
  );

  const selected = nodes.find((node) => node.key === selectedKey) || nodes[0];
  function project(point: { x: number; y: number; z: number }) {
    const x = point.x * Math.cos(rotation.yaw) - point.z * Math.sin(rotation.yaw);
    const z = point.x * Math.sin(rotation.yaw) + point.z * Math.cos(rotation.yaw);
    const y = point.y * Math.cos(rotation.pitch) - z * Math.sin(rotation.pitch);
    const depth = point.y * Math.sin(rotation.pitch) + z * Math.cos(rotation.pitch);
    const perspective = 850 / (850 + depth);
    return {
      x: 450 + x * perspective * zoom,
      y: 289 + y * perspective * zoom,
      depth,
      scale: perspective,
    };
  }
  function ring(radius: number, height = 0) {
    return Array.from({ length: 81 }, (_, i) => {
      const angle = (i / 80) * Math.PI * 2;
      const point = project({
        x: Math.cos(angle) * radius,
        y: height,
        z: Math.sin(angle) * radius,
      });
      return `${i ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`;
    }).join(' ');
  }
  const projected = nodes
    .map((node) => ({ ...node, screen: project(node.point) }))
    .sort((a, b) => b.screen.depth - a.screen.depth);
  const moved = nodes.filter((node) => node.independent.length < node.supported.length).length;
  const totalCandidates = boards.reduce((sum, board) => sum + board.candidates.length, 0);

  return (
    <section className="thesis-universe" aria-label="Thesis universe">
      <header className="universe-intro">
        <div>
          <div className="universe-eyebrow">
            <Globe2 size={15} /> A different perspective
          </div>
          <h1>Your thesis, stress-tested.</h1>
          <p>See which companies keep their footing when you take the company’s own claims away.</p>
        </div>
        <div className="universe-total">
          <strong>{totalCandidates}</strong>
          <span>
            companies · {boards.length} {boards.length === 1 ? 'theme' : 'themes'}
          </span>
        </div>
      </header>

      {!nodes.length && !totalCandidates ? (
        <div className="universe-empty">
          <Globe2 size={45} />
          <h2>Your universe starts with a theme.</h2>
          <p>
            Create a Top 5 to map the companies, their evidence and the questions that could change
            your mind.
          </p>
          {onInvestigate && (
            <button className="universe-primary" onClick={onInvestigate}>
              Build my first Top 5 <ArrowRight size={16} />
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="universe-toolbar">
            <label className="universe-filter">
              <span>Show theme</span>
              <select
                value={filter}
                onChange={(event) => {
                  setLocalFilter(event.target.value);
                  onSelectBoard?.(event.target.value === 'all' ? undefined : event.target.value);
                  setSelectedKey(undefined);
                }}
              >
                <option value="all">All my themes</option>
                {boards.map((board) => (
                  <option key={board.id} value={board.id}>
                    {board.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="universe-lens" role="group" aria-label="Evidence lens">
              <button aria-pressed={!independentOnly} onClick={() => setIndependentOnly(false)}>
                <Eye size={15} /> All evidence
              </button>
              <button aria-pressed={independentOnly} onClick={() => setIndependentOnly(true)}>
                <ShieldCheck size={15} /> Remove company claims
              </button>
            </div>
          </div>

          <div className="universe-layout">
            <div className={`universe-map-panel ${independentOnly ? 'independent-lens' : ''}`}>
              <div className="universe-map-heading">
                <span className="universe-map-badge">
                  <span /> Evidence orbit
                </span>
                <span>Drag to rotate · select a company</span>
              </div>
              <div className="universe-map" style={{ touchAction: 'none' }}>
                <svg
                  viewBox="0 0 900 580"
                  className={dragging ? 'is-dragging' : ''}
                  tabIndex={0}
                  role="group"
                  aria-label="Interactive three dimensional evidence map. Drag or use arrow keys to rotate. Company buttons are also listed below."
                  onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key))
                      return;
                    event.preventDefault();
                    setRotation((current) => ({
                      yaw:
                        current.yaw +
                        (event.key === 'ArrowLeft' ? -0.16 : event.key === 'ArrowRight' ? 0.16 : 0),
                      pitch: Math.max(
                        -0.7,
                        Math.min(
                          0.8,
                          current.pitch +
                            (event.key === 'ArrowUp' ? 0.1 : event.key === 'ArrowDown' ? -0.1 : 0),
                        ),
                      ),
                    }));
                  }}
                  onPointerDown={(event) => {
                    if ((event.target as Element).closest('button')) return;
                    drag.current = { x: event.clientX, y: event.clientY, ...rotation };
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setDragging(true);
                  }}
                  onPointerMove={(event) => {
                    if (!drag.current) return;
                    const initial = drag.current;
                    setRotation({
                      yaw: initial.yaw + (event.clientX - initial.x) * 0.007,
                      pitch: Math.max(
                        -0.7,
                        Math.min(0.8, initial.pitch + (event.clientY - initial.y) * 0.004),
                      ),
                    });
                  }}
                  onPointerUp={() => {
                    drag.current = null;
                    setDragging(false);
                  }}
                  onPointerCancel={() => {
                    drag.current = null;
                    setDragging(false);
                  }}
                >
                  <defs>
                    <radialGradient id="universe-core">
                      <stop offset="0" stopColor="#c0f7f0" stopOpacity=".75" />
                      <stop offset=".2" stopColor="#65b7de" stopOpacity=".45" />
                      <stop offset="1" stopColor="#8690e8" stopOpacity="0" />
                    </radialGradient>
                    <linearGradient id="universe-axis" x1="0" y1="0" x2="0" y2="1">
                      <stop stopColor="#a4e6dc" stopOpacity=".6" />
                      <stop offset="1" stopColor="#a9a0df" stopOpacity=".15" />
                    </linearGradient>
                  </defs>
                  <ellipse
                    cx="450"
                    cy="300"
                    rx="390"
                    ry="250"
                    fill="url(#universe-core)"
                    opacity=".2"
                  />
                  {[104, 153, 201, 249].map((radius) => (
                    <path key={radius} d={ring(radius)} className="universe-orbit" />
                  ))}
                  {[-125, 125].map((height) => (
                    <path
                      key={height}
                      d={ring(249, height)}
                      className="universe-orbit universe-orbit-faint"
                    />
                  ))}
                  {Array.from({ length: 12 }, (_, i) => {
                    const angle = (i / 12) * Math.PI * 2;
                    const a = project({ x: Math.cos(angle) * 104, y: 0, z: Math.sin(angle) * 104 });
                    const b = project({ x: Math.cos(angle) * 249, y: 0, z: Math.sin(angle) * 249 });
                    return (
                      <line
                        key={i}
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        className="universe-spoke"
                      />
                    );
                  })}
                  <line
                    x1={project({ x: 0, y: -175, z: 0 }).x}
                    y1={project({ x: 0, y: -175, z: 0 }).y}
                    x2={project({ x: 0, y: 175, z: 0 }).x}
                    y2={project({ x: 0, y: 175, z: 0 }).y}
                    stroke="url(#universe-axis)"
                    strokeWidth="1.5"
                    strokeDasharray="3 6"
                  />
                  <circle cx="450" cy="289" r="70" fill="url(#universe-core)" />
                  <circle
                    cx="450"
                    cy="289"
                    r="18"
                    fill="#b3e3e9"
                    fillOpacity=".12"
                    stroke="#a4e6df"
                    strokeOpacity=".7"
                  />
                  <path d="M443 289h14m-7-7v14" stroke="#c3faf1" strokeWidth="1.4" />
                  <text x="450" y="329" textAnchor="middle" className="universe-core-label">
                    EVIDENCE CORE
                  </text>
                  {projected.map((node) => {
                    const ground = project({ ...node.point, y: 0 });
                    const active = selected?.key === node.key;
                    const previous = project({
                      x: Math.cos(node.angle) * (104 + (1 - node.allShare) * 145),
                      y: node.point.y,
                      z: Math.sin(node.angle) * (104 + (1 - node.allShare) * 145),
                    });
                    return (
                      <g key={node.key}>
                        <line
                          x1={ground.x}
                          y1={ground.y}
                          x2={node.screen.x}
                          y2={node.screen.y}
                          stroke={node.color}
                          strokeOpacity={active ? '.65' : '.2'}
                          strokeDasharray="3 4"
                        />
                        <ellipse
                          cx={ground.x}
                          cy={ground.y}
                          rx={active ? 11 : 5}
                          ry={active ? 4 : 2}
                          fill={node.color}
                          fillOpacity=".35"
                        />
                        {independentOnly && node.allShare > node.supportShare && (
                          <>
                            <line
                              x1={previous.x}
                              y1={previous.y}
                              x2={node.screen.x}
                              y2={node.screen.y}
                              stroke={node.color}
                              strokeOpacity=".55"
                              strokeDasharray="4 5"
                            />
                            <circle
                              cx={previous.x}
                              cy={previous.y}
                              r="8"
                              fill="none"
                              stroke={node.color}
                              strokeOpacity=".5"
                            />
                          </>
                        )}
                        {active && (
                          <circle
                            cx={node.screen.x}
                            cy={node.screen.y}
                            r={31 * node.screen.scale}
                            fill={node.color}
                            fillOpacity=".08"
                            stroke={node.color}
                            strokeOpacity=".45"
                          />
                        )}
                        <foreignObject
                          x={node.screen.x - 64}
                          y={node.screen.y - 25}
                          width="128"
                          height="94"
                          style={{ overflow: 'visible' }}
                        >
                          <button
                            className={`universe-company-node ${active ? 'selected' : ''}`}
                            style={{ '--node-color': node.color } as React.CSSProperties}
                            onClick={() => setSelectedKey(node.key)}
                            aria-label={`Select ${node.candidate.company.name}, rank ${node.candidate.rank}, ${node.remaining} supported evidence records under current lens`}
                            aria-pressed={active}
                          >
                            <DomainIdentity
                              url={node.candidate.company.website}
                              name={node.candidate.company.name}
                              size={40}
                            />
                            <span>{node.candidate.company.name}</span>
                            <small>{money(node.candidate.valuation.amountUsd)} disclosed</small>
                          </button>
                        </foreignObject>
                      </g>
                    );
                  })}
                </svg>
                <div className="universe-height-label">
                  <ArrowUp size={13} />
                  <span>Higher agent confidence</span>
                </div>
                <div className="universe-low-label">
                  <ArrowDown size={13} />
                  <span>More uncertainty</span>
                </div>
                <div className="universe-zoom" role="group" aria-label="Map controls">
                  <button
                    aria-label="Zoom in"
                    disabled={zoom >= 1.25}
                    onClick={() => setZoom((current) => Math.min(1.25, current + 0.1))}
                  >
                    <Plus size={16} />
                  </button>
                  <button
                    aria-label="Zoom out"
                    disabled={zoom <= 0.7}
                    onClick={() => setZoom((current) => Math.max(0.7, current - 0.1))}
                  >
                    <Minus size={16} />
                  </button>
                  <button
                    aria-label="Reset map view"
                    onClick={() => {
                      setRotation({ yaw: -0.3, pitch: 0.24 });
                      setZoom(initialZoom());
                    }}
                  >
                    <RotateCcw size={15} />
                  </button>
                </div>
              </div>
              <div className="universe-map-explainer">
                <span>
                  <i /> Closer to the core = more cited evidence supported.
                </span>
                <span>Height = agent confidence, not expected return.</span>
              </div>
              <div className="universe-theme-legend">
                {boards
                  .filter((board) => filter === 'all' || board.id === filter)
                  .map((board) => (
                    <span key={board.id}>
                      <i style={{ background: COLORS[boards.indexOf(board) % COLORS.length] }} />
                      {board.title}
                    </span>
                  ))}
              </div>
            </div>

            {selected && (
              <aside
                className={`universe-proof-panel ${selected.candidate.latestReview ? 'has-review' : ''}`}
                aria-live="polite"
              >
                <div className="universe-proof-eyebrow">
                  Selected company{' '}
                  <span>#{selected.candidate.manualRank || selected.candidate.rank} in theme</span>
                </div>
                <div className="universe-selected-company">
                  <DomainIdentity
                    url={selected.candidate.company.website}
                    name={selected.candidate.company.name}
                    size={51}
                  />
                  <div>
                    <h2>{selected.candidate.company.name}</h2>
                    <span>{selected.board.title}</span>
                  </div>
                </div>
                <div className="universe-valuation">
                  <strong>{money(selected.candidate.valuation.amountUsd)}</strong>
                  <span>
                    Disclosed valuation · {selected.candidate.valuation.asOf}
                    <small>
                      {selected.candidate.valuation.round} ·{' '}
                      {sentenceCase(selected.candidate.valuation.basis)}
                    </small>
                  </span>
                </div>
                <div className="universe-proof-metrics">
                  <div>
                    <strong>
                      {selected.remaining}
                      <small> / {selected.evidenceCount}</small>
                    </strong>
                    <span>supported records</span>
                  </div>
                  <div>
                    <strong>{selected.independent.length}</strong>
                    <span>independent & supported</span>
                  </div>
                </div>
                {selected.candidate.latestReview && (
                  <div className="universe-review">
                    <span>
                      <ShieldCheck size={13} /> Red Team checked{' '}
                      {new Date(selected.candidate.latestReview.checkedAt).toLocaleDateString(
                        undefined,
                        { month: 'short', day: 'numeric' },
                      )}
                    </span>
                    <strong>
                      {sentenceCase(
                        selected.candidate.latestReview.verification ||
                          selected.candidate.latestReview.decision ||
                          'review completed',
                      )}{' '}
                      · {sentenceCase(selected.confidence)} confidence
                    </strong>
                    <p>{selected.candidate.latestReview.summary}</p>
                    <small>
                      Orbit reflects this review. Theme rank stays unchanged until a full shortlist
                      refresh.
                    </small>
                  </div>
                )}
                <div className="universe-reason">
                  <span>
                    <Sparkles size={14} /> Why it belongs
                  </span>
                  <p>{selected.candidate.rationale}</p>
                </div>
                <div className="universe-next-proof">
                  <span>THE NEXT PROOF</span>
                  <p>{selected.candidate.nextProof}</p>
                </div>
                <div className="universe-kill">
                  <span>WHAT WOULD BREAK THE THESIS</span>
                  <p>{selected.candidate.killCriterion}</p>
                </div>
                <button
                  className="universe-primary"
                  onClick={() => onOpenCandidate(selected.board.id, selected.candidate.company.id)}
                >
                  Open company thesis <ArrowRight size={16} />
                </button>
                <small className="universe-price-note">
                  A disclosed financing price is historical, not a current offer to invest.
                </small>
              </aside>
            )}
          </div>

          <div className={`universe-scenario ${independentOnly ? 'active' : ''}`}>
            <ShieldCheck size={22} />
            <div>
              <strong>
                {independentOnly ? 'The independence test is on.' : 'Try the independence test.'}
              </strong>
              <p>
                {independentOnly
                  ? `${moved} ${moved === 1 ? 'company loses' : 'companies lose'} supported records when company claims are excluded. Ghost markers show the original positions. Agent confidence stays unchanged.`
                  : 'Remove company claims to see whose evidence survives. Companies with less independent support move outward; the research itself stays intact.'}
              </p>
            </div>
            <span>{independentOnly ? 'Scenario · not a rerun' : 'One click. Less hype.'}</span>
          </div>

          <div className="universe-company-list" aria-label="Companies in the evidence map">
            {nodes.map((node) => (
              <button
                key={node.key}
                onClick={() => setSelectedKey(node.key)}
                aria-pressed={selected?.key === node.key}
              >
                <DomainIdentity
                  url={node.candidate.company.website}
                  name={node.candidate.company.name}
                  size={28}
                />
                <span>
                  {node.candidate.company.name}
                  <small>{node.board.title}</small>
                </span>
                <strong>
                  {node.remaining}/{node.evidenceCount}
                  <small>supported</small>
                </strong>
              </button>
            ))}
          </div>
          <p className="universe-method">
            How to read this: distance uses supported evidence records divided by all unique cited
            evidence IDs, including valuation citations. The independent lens retains supported
            independent reporting, research publications and public professional records. Height
            uses the latest Red Team review confidence when available, otherwise the shortlist
            agents’ HIGH / MEDIUM / LOW / INSUFFICIENT assessment. Horizontal direction is layout
            only. This is an evidence stress test, not geography, source track record or a
            probability of investment success.
          </p>
        </>
      )}
    </section>
  );
}
