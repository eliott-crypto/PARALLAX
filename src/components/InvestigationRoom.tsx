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
import { DomainIdentity } from './Identity';
import { sourceName } from '../lib/source-intelligence';
import { readable, dateLabel, sourceCount, uniqueSources } from '../lib/api';

function Findings({
  run,
  evidence,
  onEvidence,
}: {
  run?: AgentRun;
  evidence: Evidence[];
  onEvidence: (ids?: string[]) => void;
}) {
  if (!run) return null;
  return (
    <div className="findings">
      {run.output?.findings.map((finding, i) => {
        const citedSources = uniqueSources(
          evidence.filter((entry) => finding.evidenceIds.includes(entry.id)),
        );
        return (
          <div key={i} className="finding">
            <span className={`finding-kind ${finding.kind.toLowerCase()}`}>
              {readable(finding.kind)}
            </span>
            {finding.evidenceIds.some(
              (id) => evidence.find((source) => source.id === id)?.correction,
            ) && <span className="badge rose">Evidence revised</span>}
            <h4>{finding.title}</h4>
            <p>{finding.detail}</p>
            {citedSources.length > 0 && (
              <div className="finding-source-identities">
                {citedSources.slice(0, 2).map((source) => (
                  <button
                    className="finding-source"
                    key={source.id}
                    onClick={() => onEvidence([source.id])}
                    title={source.title}
                  >
                    <DomainIdentity
                      url={source.url}
                      name={sourceName(source.url, source.publisher)}
                      size={20}
                    />
                    <span>{sourceName(source.url, source.publisher)}</span>
                  </button>
                ))}
                <button className="citation-button" onClick={() => onEvidence(finding.evidenceIds)}>
                  {citedSources.length > 2 ? `+${citedSources.length - 2} · ` : ''}View sources{' '}
                  <ArrowUpRight size={12} />
                </button>
              </div>
            )}
          </div>
        );
      })}
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
  onComplete,
  onChallenge,
}: {
  investigation: Investigation;
  onBack: () => void;
  onEvidence: (ids?: string[]) => void;
  onWatch: () => void;
  onRecheck: () => void;
  onCancel: () => void;
  onComplete: () => void;
  onChallenge: () => void;
}) {
  const [selected, setSelected] = useState<AgentId>(() =>
    investigation.status === 'completed' ? 'committee' : 'scout',
  );
  const [tab, setTab] = useState<'workspace' | 'report'>(() =>
    investigation.status === 'completed' ? 'report' : 'workspace',
  );
  const run = investigation.agents.find((a) => a.id === selected);
  const agent = AGENTS.find((a) => a.id === selected)!;
  const completed = investigation.agents.filter((a) => a.status === 'completed').length;
  const verifier = investigation.agents.find((a) => a.id === 'verifier');
  const committee = investigation.agents.find((a) => a.id === 'committee');
  const bull = investigation.agents.find((a) => a.id === 'bull');
  const bear = investigation.agents.find((a) => a.id === 'bear');
  const sample = investigation.mode === 'sample';
  const sources = uniqueSources(investigation.evidence);
  const publishers = Array.from(
    new Map(sources.map((source) => [new URL(source.url).hostname, source])).values(),
  );
  const companies = investigation.company
    ? [investigation.company]
    : (investigation.agents.find((agent) => agent.id === 'hunter')?.output?.companies ?? []);
  const correctedEvidenceIds = new Set(
    investigation.evidence.filter((entry) => entry.correction).map((entry) => entry.id),
  );
  const knownFindings =
    committee?.output?.findings.filter(
      (finding) =>
        finding.kind === 'FACT' &&
        finding.evidenceIds.length > 0 &&
        finding.evidenceIds.every((id) =>
          investigation.evidence.some((entry) => entry.id === id && entry.status === 'SUPPORTED'),
        ) &&
        !finding.evidenceIds.some((id) => correctedEvidenceIds.has(id)),
    ) ?? [];

  const verificationRounds = investigation.events.filter(
    (event) => event.type === 'agent_started' && event.agentId === 'verifier',
  ).length;
  const canChallenge =
    investigation.mode === 'live' &&
    ['completed', 'partial'].includes(investigation.status) &&
    verificationRounds < 2 &&
    AGENTS.filter((agent) => agent.id !== 'committee').every((agent) => {
      const stage = investigation.agents.find((run) => run.id === agent.id);
      return stage?.status === 'completed' && !!stage.output;
    });
  const correctedEvidence = investigation.evidence.filter((evidence) => evidence.correction);
  const canFinish =
    investigation.mode === 'live' &&
    investigation.status === 'partial' &&
    committee?.status === 'failed' &&
    AGENTS.filter((agent) => agent.id !== 'committee').every((agent) => {
      const stage = investigation.agents.find((run) => run.id === agent.id);
      return stage?.status === 'completed' && !!stage.output;
    });

  return (
    <>
      <div className="room-breadcrumb">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={15} /> Investigations
        </button>
        <ChevronRight size={13} />
        <span>{investigation.company?.name ?? 'Research findings'}</span>
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
            {sample ? 'CURATED EXAMPLE' : dateLabel(investigation.createdAt)}
          </div>
          <h1>{investigation.title}</h1>
          {investigation.query.trim().toLowerCase() !==
            investigation.title.trim().toLowerCase() && <p>{investigation.query}</p>}
          {companies.length > 0 && (
            <div className="room-company-identities" aria-label="Companies researched">
              {companies.map((company) => (
                <a
                  className="room-company-identity"
                  key={company.id}
                  href={company.website}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <DomainIdentity url={company.website} name={company.name} size={32} />
                  <span>{company.name}</span>
                  <ArrowUpRight size={13} />
                </a>
              ))}
            </div>
          )}
        </div>
        <div className="room-actions">
          {canChallenge && (
            <button className="button ghost" onClick={onChallenge}>
              <Scale size={15} />
              Challenge thesis
            </button>
          )}
          {canFinish && (
            <button className="button primary" onClick={onComplete}>
              <RotateCw size={15} />
              Finish assessment
            </button>
          )}
          <button
            className={`button ghost ${investigation.watched ? 'is-watched' : ''}`}
            onClick={onWatch}
          >
            <Bookmark size={15} fill={investigation.watched ? 'currentColor' : 'none'} />
            {investigation.watched ? 'Saved' : 'Save research'}
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
      {correctedEvidence.length > 0 && (
        <div className="sample-banner correction-banner">
          <ShieldCheck size={18} />
          <span>
            <b>{correctedEvidence.length} earlier evidence claims revised after verification.</b>{' '}
            Original findings are preserved; the assessment uses the corrections.
          </span>
          <button
            className="text-button"
            onClick={() => onEvidence(correctedEvidence.map((evidence) => evidence.id))}
          >
            Review corrections <ArrowUpRight size={14} />
          </button>
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
          <span>{sourceCount(investigation.evidence)}</span> cited sources{' '}
          <ArrowUpRight size={13} />
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
        <button className={tab === 'report' ? 'selected' : ''} onClick={() => setTab('report')}>
          Findings{committee?.output && <span className="tiny-dot" />}
        </button>
        <button
          className={tab === 'workspace' ? 'selected' : ''}
          onClick={() => setTab('workspace')}
        >
          Research team
        </button>
        <button onClick={() => onEvidence()}>
          Sources <span>{sources.length}</span>
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
              {!sample &&
                run &&
                (run.inputTokens !== undefined ||
                  run.outputTokens !== undefined ||
                  run.searches !== undefined) && (
                  <details className="execution-audit">
                    <summary>Execution details · actual provider usage</summary>
                    <span>{run.model ?? investigation.model}</span>
                    <div>
                      {run.inputTokens !== undefined && (
                        <span>
                          <b>{run.inputTokens.toLocaleString()}</b> input tokens
                        </span>
                      )}
                      {run.outputTokens !== undefined && (
                        <span>
                          <b>{run.outputTokens.toLocaleString()}</b> output tokens
                        </span>
                      )}
                      {run.searches !== undefined && (
                        <span>
                          <b>{run.searches.toLocaleString()}</b> web searches
                        </span>
                      )}
                    </div>
                  </details>
                )}
              {run?.output ? (
                <>
                  {(correctedEvidence.length > 0 || !!investigation.reviewNotes?.length) &&
                    selected !== 'committee' && (
                      <p className="historical-note">
                        Earlier research output. Source corrections and the final committee memo
                        take precedence.
                      </p>
                    )}
                  <p className="agent-summary">{run.output.summary}</p>
                  <Findings run={run} evidence={investigation.evidence} onEvidence={onEvidence} />
                  {run.output.companies?.length ? (
                    <div className="agent-companies">
                      <h4>Companies discovered</h4>
                      {run.output.companies.map((c) => (
                        <div className="agent-company" key={c.id}>
                          <a href={c.website} target="_blank" rel="noopener noreferrer">
                            <DomainIdentity url={c.website} name={c.name} size={36} />
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
                              ↗{' '}
                              {sourceCount(
                                investigation.evidence.filter((entry) =>
                                  c.evidenceIds.includes(entry.id),
                                ),
                              )}{' '}
                              sources
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
          <details className="research-history">
            <summary>History · debate, verification and activity</summary>
            {!!investigation.reviewNotes?.length && (
              <p className="muted text-xs">
                Earlier debate and verification outputs are preserved below. The final committee
                assessment supersedes claims qualified by the source-quality review.
              </p>
            )}
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
                <Findings run={bull} evidence={investigation.evidence} onEvidence={onEvidence} />
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
                <Findings run={bear} evidence={investigation.evidence} onEvidence={onEvidence} />
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
          </details>
        </>
      ) : (
        <section className="panel memo">
          <div className="memo-heading">
            <div>
              <div className="eyebrow">RESEARCH FINDINGS</div>
              <h2>What the evidence says</h2>
              <p>
                {sample
                  ? 'Illustrative assessment based on a curated research sample.'
                  : investigation.status === 'completed'
                    ? `Completed ${dateLabel(investigation.completedAt)} · Independently checked by the research team`
                    : 'The final assessment appears after research and independent verification.'}
              </p>
            </div>
            <BrandMark />
          </div>
          {sources.length > 0 && (
            <div className="memo-source-strip" aria-label="Research sources">
              <span>Based on {sources.length} sources</span>
              {publishers.slice(0, 5).map((source) => (
                <button
                  key={source.id}
                  onClick={() => onEvidence([source.id])}
                  title={source.title}
                >
                  <DomainIdentity
                    url={source.url}
                    name={sourceName(source.url, source.publisher)}
                    size={26}
                  />
                  <span>{sourceName(source.url, source.publisher)}</span>
                </button>
              ))}
            </div>
          )}
          {investigation.reviewNotes?.length ? (
            <details className="memo-review">
              <summary>Source-quality review incorporated</summary>
              {investigation.reviewNotes.map((note, index) => (
                <p key={index}>{note}</p>
              ))}
            </details>
          ) : null}
          <div className="decision-box">
            <span>DECISION · {readable(investigation.confidence)} confidence</span>
            <h3>{investigation.decision ?? committee?.output?.decision ?? 'Assessment pending'}</h3>
            <p>
              {committee?.output?.summary ??
                'The committee will synthesize the evidence, the Bull and Bear cases, and the Verifier’s findings.'}
            </p>
          </div>
          {committee?.output && (
            <div
              className={`research-findings-grid ${knownFindings.length ? '' : 'single-column'}`}
            >
              {knownFindings.length > 0 && (
                <section className="research-findings-known">
                  <h3>
                    <ShieldCheck size={18} /> What is supported
                  </h3>
                  {knownFindings.length ? (
                    <Findings
                      run={{
                        ...committee,
                        output: { ...committee.output, findings: knownFindings },
                      }}
                      evidence={investigation.evidence}
                      onEvidence={onEvidence}
                    />
                  ) : (
                    <p className="muted">
                      The committee has not established a sufficiently supported factual finding.
                      Review the open questions and sources before acting.
                    </p>
                  )}
                </section>
              )}
              <section className="research-findings-open">
                <h3>
                  <Scale size={18} />{' '}
                  {knownFindings.length ? 'What still needs proof' : 'Findings & limitations'}
                </h3>
                {committee.output.findings.some((finding) => !knownFindings.includes(finding)) ? (
                  <Findings
                    run={{
                      ...committee,
                      output: {
                        ...committee.output,
                        findings: committee.output.findings.filter(
                          (finding) => !knownFindings.includes(finding),
                        ),
                      },
                    }}
                    evidence={investigation.evidence}
                    onEvidence={onEvidence}
                  />
                ) : (
                  <p className="muted">
                    No additional uncertainty was classified in the committee findings. Review the
                    next steps and sources for remaining diligence.
                  </p>
                )}
              </section>
            </div>
          )}
          {committee?.output?.questions?.length ? (
            <div className="memo-actions">
              <h3>What to do next</h3>
              {committee.output.questions.slice(0, 3).map((q, i) => (
                <p key={q}>
                  <span>0{i + 1}</span>
                  {q}
                </p>
              ))}
              {committee.output.questions.length > 3 && (
                <details className="research-more-questions">
                  <summary>
                    {committee.output.questions.length - 3} more diligence questions
                  </summary>
                  {committee.output.questions.slice(3).map((question) => (
                    <p key={question}>{question}</p>
                  ))}
                </details>
              )}
            </div>
          ) : null}
          <div className="memo-sources">
            <div className="panel-heading">
              <h3>Sources behind this research</h3>
              <button className="text-button" onClick={() => onEvidence()}>
                Review all {sources.length} <ArrowUpRight size={14} />
              </button>
            </div>
            {sources.slice(0, 5).map((e) => (
              <a href={e.url} key={e.id} target="_blank" rel="noopener noreferrer">
                <DomainIdentity url={e.url} name={sourceName(e.url, e.publisher)} size={36} />
                <div>
                  <strong>{e.title}</strong>
                  <small>
                    {sourceName(e.url, e.publisher)} · {readable(e.type)} · {readable(e.status)}
                  </small>
                </div>
                <ArrowUpRight size={15} />
              </a>
            ))}
          </div>
          {!sample && (
            <details className="memo-review">
              <summary>Research audit · models, usage and source review</summary>
              <p>
                Research: {investigation.model ?? 'Claude'} · Final assessment:{' '}
                {committee?.model ?? investigation.model ?? 'Claude'}.
              </p>
              <p>
                {investigation.totalInputTokens.toLocaleString()} input tokens ·{' '}
                {investigation.totalOutputTokens.toLocaleString()} output tokens. Open Research team
                for individual executions and history.
              </p>
            </details>
          )}
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
