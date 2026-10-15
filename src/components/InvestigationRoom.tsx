import { useState } from 'react';
import {
  ArrowUpRight,
  ArrowLeft,
  Download,
  Bookmark,
  RotateCw,
  Square,
  ShieldCheck,
  Scale,
  ChevronRight,
  AlertCircle,
  FileCheck2,
  CheckCircle2,
} from 'lucide-react';
import {
  AGENTS,
  type Investigation,
  type AgentId,
  type Evidence,
  type AgentRun,
} from '../../shared/types';
import { AgentConstellation } from './Visuals';
import { readable, dateLabel } from '../lib/api';

function Findings({ run, onEvidence }: { run?: AgentRun; onEvidence: (ids?: string[]) => void }) {
  if (!run) return null;
  return (
    <div className="findings">
      {run.output?.findings.map((finding, i) => (
        <div key={i} className="finding">
          <span className={`finding-kind ${finding.kind.toLowerCase()}`}>{finding.kind}</span>
          <h4>{finding.title}</h4>
          <p>{finding.detail}</p>
          {finding.evidenceIds.length > 0 && (
            <button className="citation-button" onClick={() => onEvidence(finding.evidenceIds)}>
              ↗ {finding.evidenceIds.length} source{finding.evidenceIds.length === 1 ? '' : 's'}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
export default function InvestigationRoom({
  investigation,
  onBack,
  onEvidence,
  onWatch,
  onRecheck,
  onCancel,
}: {
  investigation: Investigation;
  onBack: () => void;
  onEvidence: (ids?: string[]) => void;
  onWatch: () => void;
  onRecheck: () => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<AgentId>('scout');
  const [tab, setTab] = useState<'workspace' | 'report'>('workspace');
  const run = investigation.agents.find((a) => a.id === selected);
  const agent = AGENTS.find((a) => a.id === selected)!;
  const completed = investigation.agents.filter((a) => a.status === 'completed').length;
  const verifier = investigation.agents.find((a) => a.id === 'verifier');
  const committee = investigation.agents.find((a) => a.id === 'committee');
  const bull = investigation.agents.find((a) => a.id === 'bull');
  const bear = investigation.agents.find((a) => a.id === 'bear');
  const sample = investigation.mode === 'sample';

  return (
    <>
      <div className="room-breadcrumb">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={15} /> Investigations
        </button>
        <ChevronRight size={13} />
        <span>Investigation room</span>
      </div>
      <div className="room-title">
        <div>
          <div className="eyebrow">
            <span className={`status-dot ${investigation.status === 'running' ? 'active' : ''}`} />
            {sample
              ? 'RESEARCH SAMPLE'
              : investigation.status === 'running'
                ? 'LIVE INVESTIGATION'
                : 'RECORDED INVESTIGATION'}{' '}
            <span className="eyebrow-divider">/</span>{' '}
            {sample ? 'EDITORIAL WALKTHROUGH' : investigation.id.slice(-8)}
          </div>
          <h1>{investigation.title}</h1>
          <p>{investigation.query}</p>
        </div>
        <div className="room-actions">
          <button
            className={`button ghost ${investigation.watched ? 'is-watched' : ''}`}
            onClick={onWatch}
          >
            <Bookmark size={15} fill={investigation.watched ? 'currentColor' : 'none'} />
            {investigation.watched ? 'Saved' : 'Watch thesis'}
          </button>
          <button
            className="button ghost"
            onClick={() => window.open(`/api/investigations/${investigation.id}/export`, '_blank')}
          >
            <Download size={15} />
            Export
          </button>
        </div>
      </div>
      {sample && (
        <div className="sample-banner">
          <FileCheck2 size={17} />
          <span>
            <b>Research sample • not a live Claude run.</b> Explore the research workflow using
            curated, cited material.
          </span>
          <button className="text-button" onClick={onRecheck}>
            Run live research <ArrowUpRight size={14} />
          </button>
        </div>
      )}
      {investigation.error && (
        <div className="error-banner">
          <AlertCircle size={18} />
          {investigation.error}
        </div>
      )}
      <div className="room-summary">
        <div>
          <span className={`status-dot ${investigation.status === 'running' ? 'active' : ''}`} />
          <b>{sample ? 'Sample overview' : readable(investigation.status)}</b>
        </div>
        <div>
          <span>{completed}/9</span> agents {sample ? 'illustrated' : 'completed'}
        </div>
        <button onClick={() => onEvidence()}>
          <span>{investigation.evidence.length}</span> cited sources <ArrowUpRight size={13} />
        </button>
        <div>
          <span>{sample ? 'Qualitative' : readable(investigation.confidence)}</span> confidence
        </div>
        <div className="room-summary-end">
          {investigation.status === 'running' ? (
            <button className="text-button" onClick={onCancel}>
              <Square size={12} />
              Stop run
            </button>
          ) : (
            <span>{dateLabel(investigation.createdAt)}</span>
          )}
        </div>
      </div>
      <div className="tabs room-tabs">
        <button
          className={tab === 'workspace' ? 'selected' : ''}
          onClick={() => setTab('workspace')}
        >
          Agent workspace
        </button>
        <button className={tab === 'report' ? 'selected' : ''} onClick={() => setTab('report')}>
          Investment memo{committee?.output && <span className="tiny-dot" />}
        </button>
        <button onClick={() => onEvidence()}>
          Evidence library <span>{investigation.evidence.length}</span>
        </button>
      </div>
      {tab === 'workspace' ? (
        <>
          <div className="room-workspace">
            <section className="panel agent-panel">
              <AgentConstellation
                investigation={investigation}
                selected={selected}
                onSelect={setSelected}
              />
              <div className="graph-footnote">
                <span>
                  <i className="color-dot" style={{ background: '#9fc8b6' }} />
                  Completed
                </span>
                <span>
                  <i className="color-dot" style={{ background: '#a99adc' }} />
                  In progress
                </span>
                <span>Parallel perspectives → independent verification</span>
              </div>
            </section>
            <section className="panel selected-agent">
              <div className="panel-heading">
                <div className="agent-detail-heading">
                  <span className="agent-detail-avatar" style={{ color: agent.color }}>
                    <ShieldCheck size={23} />
                  </span>
                  <div>
                    <h3>{agent.name}</h3>
                    <small>{agent.role}</small>
                  </div>
                </div>
                <span className={`badge ${run?.status === 'running' ? 'purple' : ''}`}>
                  {sample ? 'sample' : (run?.status ?? 'queued')}
                </span>
              </div>
              {run?.output ? (
                <>
                  <p className="agent-summary">{run.output.summary}</p>
                  <Findings run={run} onEvidence={onEvidence} />
                  {run.output.companies?.length ? (
                    <div className="agent-companies">
                      <h4>Companies discovered</h4>
                      {run.output.companies.map((c) => (
                        <div className="agent-company" key={c.id}>
                          <a href={c.website} target="_blank" rel="noopener noreferrer">
                            <span className="company-avatar">{c.name[0]}</span>
                            <div>
                              <strong>{c.name}</strong>
                              <small>{c.category}</small>
                            </div>
                            <ArrowUpRight size={15} />
                          </a>
                          <p>{c.description}</p>
                          <p>
                            <b>Thesis alignment</b> {c.alignment}
                          </p>
                          <div className="agent-company-uncertainty">{c.uncertainty}</div>
                          {c.evidenceIds.length > 0 && (
                            <button
                              className="citation-button"
                              onClick={() => onEvidence(c.evidenceIds)}
                            >
                              ↗ {c.evidenceIds.length} sources
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {run.output.causalChain?.length ? (
                    <div className="agent-causal-chain">
                      <h4>Causal reasoning</h4>
                      {run.output.causalChain.map((link, i) => (
                        <div key={i}>
                          <span>0{i + 1}</span>
                          <p>
                            {link.label}
                            <small>{link.status}</small>
                          </p>
                          {link.evidenceIds.length > 0 && (
                            <button
                              className="citation-button"
                              onClick={() => onEvidence(link.evidenceIds)}
                            >
                              ↗
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {run.output.questions.length > 0 && (
                    <div className="open-questions">
                      <h4>Questions to resolve</h4>
                      {run.output.questions.map((q) => (
                        <p key={q}>↳ {q}</p>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="agent-waiting">
                  <div className={`waiting-orbit ${run?.status === 'running' ? 'spinning' : ''}`}>
                    <ShieldCheck size={27} />
                  </div>
                  <h3>
                    {run?.status === 'running'
                      ? 'Research in progress'
                      : run?.status === 'failed'
                        ? 'Agent could not complete'
                        : 'Waiting for upstream research'}
                  </h3>
                  <p>
                    {run?.error ??
                      'Agent findings and citations will appear here as the investigation progresses.'}
                  </p>
                </div>
              )}
            </section>
          </div>
          <div className="debate-grid">
            <section className="panel argument bull">
              <div className="panel-heading">
                <h3>
                  <span className="argument-icon">↗</span>The Bull
                </h3>
                <span className="badge green">Investment case</span>
              </div>
              <p>
                {bull?.output?.summary ??
                  'The investment case will be constructed from the research evidence.'}
              </p>
              <Findings run={bull} onEvidence={onEvidence} />
            </section>
            <section className="panel argument bear">
              <div className="panel-heading">
                <h3>
                  <span className="argument-icon">↘</span>The Bear
                </h3>
                <span className="badge rose">Adversarial challenge</span>
              </div>
              <p>
                {bear?.output?.summary ??
                  'An independent agent will challenge the thesis and its assumptions.'}
              </p>
              <Findings run={bear} onEvidence={onEvidence} />
            </section>
          </div>
          <section className="panel verification-panel">
            <div className="verification-symbol">
              <Scale size={27} />
            </div>
            <div>
              <div className="eyebrow">INDEPENDENT VERIFICATION</div>
              <h3>{verifier?.output?.verification ?? 'The thesis must survive the evidence.'}</h3>
              <p>
                {verifier?.output?.disputedClaim ??
                  'The Verifier independently researches a disputed claim raised during the adversarial round.'}
              </p>
              {(bull?.output?.revision || verifier?.output?.revision) && (
                <div className="revision">
                  <CheckCircle2 size={16} />
                  <span>
                    <b>Thesis revised after verification</b>
                    <br />
                    {bull?.output?.revision ?? verifier?.output?.revision}
                  </span>
                </div>
              )}
            </div>
            {verifier?.output && (
              <button
                className="button ghost"
                onClick={() => {
                  setSelected('verifier');
                  window.scrollTo({ top: 300, behavior: 'smooth' });
                }}
              >
                View findings <ArrowUpRight size={14} />
              </button>
            )}
          </section>
          <section className="panel activity-panel">
            <div className="panel-heading">
              <h3>Research activity</h3>
              <span className="muted text-xs">
                {sample ? 'Curated sample events' : 'Actual execution events'}
              </span>
            </div>
            <div className="activity-list">
              {investigation.events.length ? (
                investigation.events
                  .slice()
                  .reverse()
                  .slice(0, 20)
                  .map((event) => (
                    <div className="activity-event" key={event.id}>
                      <span className="activity-dot" />
                      <time>
                        {new Date(event.timestamp).toLocaleTimeString('en-GB', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </time>
                      <b>{AGENTS.find((a) => a.id === event.agentId)?.name ?? 'System'}</b>
                      <p>{event.message}</p>
                    </div>
                  ))
              ) : (
                <p className="muted">
                  Research events will appear when a live investigation starts.
                </p>
              )}
            </div>
          </section>
        </>
      ) : (
        <section className="panel memo">
          <div className="memo-heading">
            <div>
              <div className="eyebrow">PARALLAX / INVESTMENT RESEARCH</div>
              <h2>{investigation.title}</h2>
              <p>
                {sample
                  ? 'Illustrative assessment based on a curated research sample.'
                  : `Research completed ${dateLabel(investigation.completedAt)} · ${investigation.model ?? 'Claude'}`}
              </p>
            </div>
            <BrandMark />
          </div>
          <div className="decision-box">
            <span>COMMITTEE ASSESSMENT</span>
            <h3>{investigation.decision ?? committee?.output?.decision ?? 'Assessment pending'}</h3>
            <p>
              {committee?.output?.summary ??
                'The committee will synthesize the evidence, the Bull and Bear cases, and the Verifier’s findings.'}
            </p>
          </div>
          <Findings run={committee} onEvidence={onEvidence} />
          {committee?.output?.questions?.length ? (
            <div className="memo-actions">
              <h3>Next diligence actions</h3>
              {committee.output.questions.map((q, i) => (
                <p key={q}>
                  <span>0{i + 1}</span>
                  {q}
                </p>
              ))}
            </div>
          ) : null}
          <div className="memo-sources">
            <h3>Evidence & sources</h3>
            {investigation.evidence.map((e, i) => (
              <a href={e.url} key={e.id} target="_blank" rel="noopener noreferrer">
                <span>{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <strong>{e.title}</strong>
                  <small>
                    {e.publisher} · {dateLabel(e.publishedAt)} · retrieved{' '}
                    {dateLabel(e.retrievedAt)}
                  </small>
                </div>
                <ArrowUpRight size={15} />
              </a>
            ))}
          </div>
          <p className="memo-disclaimer">
            Research for investment discovery. Evidence quality and unresolved assumptions are
            presented explicitly. This is not an investment recommendation.
          </p>
        </section>
      )}
    </>
  );
}
function BrandMark() {
  return (
    <div className="memo-mark">
      P<span>↗</span>
    </div>
  );
}
