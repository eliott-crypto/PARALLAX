import { ArrowUpRight, ScanLine, Zap, Search, Check, Circle } from 'lucide-react';
import type { Signal, Evidence, Investigation, AgentId } from '../../shared/types';
import { AGENTS } from '../../shared/types';

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'compact' : ''}`}>
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <path d="M16 2 29 25H3L16 2Z" stroke="url(#brand)" strokeWidth="2" />
        <path d="m16 10 9 16H7l9-16Z" stroke="#c1b5ff" strokeWidth="1.5" />
        <path d="M16 2v28M3 25l26-15M29 25 3 10" stroke="#a6c5ff" strokeWidth=".7" opacity=".6" />
        <defs>
          <linearGradient id="brand">
            <stop stopColor="#a1d8ff" />
            <stop offset="1" stopColor="#b39af3" />
          </linearGradient>
        </defs>
      </svg>
      {!compact && (
        <span>
          PARALLAX<span className="brand-dot">®</span>
        </span>
      )}
    </div>
  );
}
export function OrbitGraphic({ count = 9 }: { count?: number }) {
  return (
    <div className="orbit-graphic">
      <svg viewBox="0 0 310 220" aria-hidden="true">
        <defs>
          <radialGradient id="orb">
            <stop stopColor="#b5adff" />
            <stop offset=".3" stopColor="#6265a3" />
            <stop offset="1" stopColor="#1d2631" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="ribbon">
            <stop stopColor="#8cd1df" />
            <stop offset="1" stopColor="#b8a0f5" />
          </linearGradient>
        </defs>
        <g transform="translate(155 110)">
          <circle r="80" fill="url(#orb)" opacity=".65" />
          <g stroke="#9b9dcb" fill="none">
            <ellipse rx="114" ry="40" transform="rotate(-28)" opacity=".4" />
            <ellipse rx="114" ry="40" transform="rotate(28)" opacity=".3" />
            <ellipse rx="80" ry="80" opacity=".14" />
            <circle r="101" strokeDasharray="2 5" opacity=".23" />
          </g>
          {Array.from({ length: 42 }, (_, i) => (
            <path
              key={i}
              d={`M ${Math.cos((i / 42) * Math.PI * 2) * 43} ${Math.sin((i / 42) * Math.PI * 2) * 43} L ${Math.cos((i / 42) * Math.PI * 2) * (i % 2 ? 57 : 65)} ${Math.sin((i / 42) * Math.PI * 2) * (i % 2 ? 57 : 65)}`}
              stroke="url(#ribbon)"
              opacity=".75"
            />
          ))}
          <circle r="34" fill="#242838" stroke="#b6bded" strokeOpacity=".3" />
          <path d="M0-18 16 11h-32L0-18Z" fill="none" stroke="#d7ddff" strokeWidth="1.4" />
          <path d="M0-9 10 17h-20L0-9Z" fill="none" stroke="#a79de9" />
          <circle cx="99" cy="-47" r="5" fill="#c5b7ff" />
          <circle cx="-75" cy="52" r="4" fill="#95c5e0" />
        </g>
      </svg>
      <span className="orbit-label left">
        INDEPENDENT
        <br />
        PERSPECTIVES
      </span>
      <span className="orbit-label right">
        <b>{count}</b> research agents
      </span>
    </div>
  );
}
export function MiniVisual({ variant }: { variant: number }) {
  return (
    <svg className="mini-visual" viewBox="0 0 100 80" fill="none" aria-hidden="true">
      {variant === 0 ? (
        <>
          {Array.from({ length: 7 }, (_, i) => (
            <g key={i}>
              <path
                d={`M${15 + i * 11} ${14 + (i % 3) * 8}v${37 - (i % 2) * 9}`}
                stroke="#9baec1"
                opacity=".35"
              />
              <rect
                x={12 + i * 11}
                y={28 + (i % 3) * 8}
                width="6"
                height={16 - (i % 2) * 7}
                rx="2"
                fill={i % 2 ? '#a9cce4' : '#c0b1ed'}
              />
            </g>
          ))}
        </>
      ) : variant === 1 ? (
        <>
          <path
            d="M3 66C20 70 21 15 35 20S44 70 59 40 78 58 97 8"
            stroke="#a9c8eb"
            strokeWidth="2"
          />
          <path d="M3 66C20 70 21 15 35 20S44 70 59 40 78 58 97 8V80H3Z" fill="url(#mini)" />
          <defs>
            <linearGradient id="mini" x2="0" y2="1">
              <stop stopColor="#b3c6e5" stopOpacity=".3" />
              <stop offset="1" stopColor="#b3c6e5" stopOpacity="0" />
            </linearGradient>
          </defs>
        </>
      ) : variant === 2 ? (
        <>
          {Array.from({ length: 16 }, (_, i) => (
            <path
              key={i}
              d={`M${5 + i * 6} ${40 - Math.sin((i / 15) * Math.PI) * 30}v${Math.sin((i / 15) * Math.PI) * 60}`}
              stroke={i % 2 ? '#a5d6d0' : '#9883cb'}
              strokeWidth="2"
            />
          ))}
        </>
      ) : (
        <>
          {Array.from({ length: 20 }, (_, i) => (
            <rect
              key={i}
              x={9 + (i % 5) * 15}
              y={10 + Math.floor(i / 5) * 15}
              width="11"
              height="11"
              rx="2"
              fill={i === 8 ? '#bcb0ef' : i === 13 ? '#849dd0' : '#353743'}
              opacity={i === 8 || i === 13 ? 1 : 0.5}
            />
          ))}
        </>
      )}
    </svg>
  );
}
export function CausalMap({
  signal,
  onInvestigate,
}: {
  signal?: Signal;
  onInvestigate: () => void;
}) {
  const chain = signal?.causalChain.slice(0, 4) ?? [];
  return (
    <div className="causal-wrap">
      <div className="causal-origin">
        <div className="origin-glow">
          <Zap size={26} strokeWidth={1.3} />
        </div>
        <span>THE CATALYST</span>
        <strong>{signal?.title ?? 'Connect a change to an opportunity'}</strong>
        <small>Evidence is the starting point.</small>
      </div>
      <div className="causal-tree">
        {chain.map((link, i) => (
          <div className="causal-branch" key={i}>
            <span className="branch-line" />
            <div className={`causal-node ${i === chain.length - 1 ? 'last' : ''}`}>
              <span className="node-index">0{i + 1}</span>
              <div>
                <small className={link.status === 'VERIFIED' ? 'verified' : ''}>
                  {link.status}
                </small>
                <p>{link.label}</p>
              </div>
            </div>
          </div>
        ))}
        {chain.length > 0 && (
          <button className="text-button causal-action" onClick={onInvestigate}>
            Follow the thesis <ArrowUpRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
export function EvidenceChart({ evidence }: { evidence: Evidence[] }) {
  const groups = [
    {
      label: 'Official documents',
      color: '#a695d9',
      value: evidence.filter((e) => e.type === 'OFFICIAL_DOCUMENT').length,
    },
    {
      label: 'Company sources',
      color: '#7bb5bd',
      value: evidence.filter((e) => e.type === 'FIRST_PARTY_COMPANY_CLAIM').length,
    },
    {
      label: 'Independent reports',
      color: '#c3ad7c',
      value: evidence.filter((e) => e.type === 'INDEPENDENT_REPORT').length,
    },
    {
      label: 'Research & other',
      color: '#7689b9',
      value: evidence.filter(
        (e) =>
          !['OFFICIAL_DOCUMENT', 'FIRST_PARTY_COMPANY_CLAIM', 'INDEPENDENT_REPORT'].includes(
            e.type,
          ),
      ).length,
    },
  ];
  const total = Math.max(evidence.length, 1);
  let accumulated = 0;
  return (
    <div className="evidence-chart">
      <div className="donut">
        <svg viewBox="0 0 200 200">
          <circle cx="100" cy="100" r="76" fill="none" stroke="#282a33" strokeWidth="22" />
          {groups.map((g) => {
            const offset = accumulated;
            accumulated += (g.value / total) * 100;
            return (
              <circle
                key={g.label}
                cx="100"
                cy="100"
                r="76"
                fill="none"
                stroke={g.color}
                strokeWidth="22"
                strokeDasharray={`${(g.value / total) * 477.5} 477.5`}
                strokeDashoffset={(-offset / 100) * 477.5}
                transform="rotate(-90 100 100)"
              />
            );
          })}
          <circle
            cx="100"
            cy="100"
            r="53"
            fill="none"
            stroke="#898ca1"
            strokeOpacity=".1"
            strokeDasharray="2 3"
          />
        </svg>
        <div className="donut-label">
          <strong>{evidence.length}</strong>
          <span>sources</span>
        </div>
      </div>
      <div className="chart-legend">
        {groups.map((g) => (
          <div key={g.label}>
            <span className="color-dot" style={{ background: g.color }} />
            {g.label}
            <b>{g.value}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
export function AgentConstellation({
  investigation,
  selected,
  onSelect,
}: {
  investigation: Investigation;
  selected: AgentId;
  onSelect: (id: AgentId) => void;
}) {
  return (
    <div className="agent-constellation">
      <div className="agent-path-label">
        <ScanLine size={14} /> NINE PERSPECTIVES. ONE THESIS.
      </div>
      <div className="agent-grid">
        {AGENTS.map((agent, i) => {
          const run = investigation.agents.find((a) => a.id === agent.id);
          return (
            <button
              key={agent.id}
              onClick={() => onSelect(agent.id)}
              className={`agent-node ${run?.status ?? 'queued'} ${selected === agent.id ? 'selected' : ''}`}
              style={{ '--agent-color': agent.color } as React.CSSProperties}
            >
              <span className="agent-avatar">
                {run?.status === 'completed' ? (
                  <Check size={17} />
                ) : run?.status === 'running' ? (
                  <Search size={17} className="pulse-icon" />
                ) : (
                  <Circle size={16} />
                )}
              </span>
              <div>
                <span className="agent-step">
                  0{i + 1} / {run?.status ?? 'queued'}
                </span>
                <strong>{agent.name}</strong>
                <small>{agent.role}</small>
              </div>
              <span className="agent-node-dot" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
