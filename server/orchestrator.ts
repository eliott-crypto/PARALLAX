import { randomUUID } from 'node:crypto';
import {
  AGENTS,
  AgentOutputSchema,
  SignalSchema,
  type AgentEvent,
  type AgentId,
  type AgentOutput,
  type AgentRun,
  type Evidence,
  type Investigation,
  type RadarData,
} from '../shared/types.js';
import { canonicalUrl, MODEL, ResearchError, runClaudeAgent, TokenBudget } from './claude.js';

const now = () => new Date().toISOString();
const roles: Record<AgentId, string> = {
  scout:
    'The Scout: identify a timely, non-obvious public technological, regulatory, or market signal. Establish exactly what changed, when, and why it matters. Search primary sources. Never claim the current date is an event date without a published source.',
  causal:
    'Causal Analyst: build a chain from the observed signal to first-, second-, and third-order demand. Label each causal link VERIFIED only if directly supported; otherwise REASONED HYPOTHESIS or SPECULATIVE. Identify where the causal chain can break.',
  hunter:
    'Company Hunter: identify up to three real, preferably private early-stage companies positioned to benefit. Search official company sources. Verify names and domains from retrieved results. Explain the specific link to the causal chain, uncertainty, and evidence. No made-up startups or estimated funding.',
  founder:
    'Founder Analyst: examine only publicly documented professional founder history, relevant technical work, prior employment, and disclosed operating experience. Cite professional records or official biographies. Mark unknowns. Do not infer personal traits or research private life.',
  competitive:
    'Competitive Analyst: investigate real alternatives, incumbents, differentiation, technical dependencies, and barriers. Company statements are COMPANY CLAIM, not independent verification. Identify adoption and distribution bottlenecks.',
  bull: 'The Bull: make the strongest evidence-grounded investment research case while retaining uncertainties. Explicitly distinguish a commercial hypothesis from an observed fact. Do not give personalized financial advice or claim guaranteed returns.',
  bear: 'The Bear: independently challenge the thesis, company fit, timing, and causal assumptions. State one precise falsifiable disputedClaim that matters most. Prefer a challenge testable with fresh source research. Distinguish absent evidence from evidence of absence.',
  verifier:
    "The Verifier: independently fact-check the Bear's disputedClaim against the Bull case. You MUST run fresh web searches now, including a source independent of company marketing where available. State disputedClaim and verification as SUPPORTED, CONTRADICTED, PARTIALLY SUPPORTED, or UNRESOLVED. Cite the specific material resolving the dispute and describe residual unknowns. Never call a claim verified merely because earlier agents repeated it.",
  committee:
    'Investment Committee: assess the whole record including the original Bull case, Bear challenge, independent verification, and Bull revision. Choose PRIORITISE RESEARCH, MONITOR, PASS, or INSUFFICIENT EVIDENCE. Give a clear reason, residual uncertainty, and concrete next research questions. This is an early-stage research prioritization decision, never a recommendation to buy or sell securities.',
};

function combineEvidence(previous: Evidence[], incoming: Evidence[]): Evidence[] {
  const result = new Map(previous.map((e) => [e.id, e]));
  for (const evidence of incoming) if (!result.has(evidence.id)) result.set(evidence.id, evidence);
  return [...result.values()];
}
function message(error: unknown): string {
  return error instanceof ResearchError
    ? error.message
    : error instanceof Error && error.name === 'AbortError'
      ? 'Investigation cancelled.'
      : 'This research stage could not complete. Its earlier evidence has been preserved.';
}
function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Investigation cancelled.', 'AbortError');
}

/** Each role is a separate Claude Messages call; source evidence and feedback are explicit inputs. */
export async function runInvestigation(
  investigation: Investigation,
  onUpdate: (event: AgentEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const budget = new TokenBudget();
  investigation.mode = 'live';
  investigation.model = MODEL();
  investigation.status = 'running';
  const outputs: Partial<Record<AgentId, AgentOutput>> = {};
  const requestedCompany = investigation.company;
  const researchGaps: string[] = [];
  let revision: AgentOutput | undefined;
  let materialGap = false;
  let companyIdentityGap = false;
  const emit = (
    type: string,
    text: string,
    agentId?: AgentId,
    payload?: unknown,
    evidenceIds?: string[],
  ) => {
    const event: AgentEvent = {
      id: randomUUID(),
      investigationId: investigation.id,
      timestamp: now(),
      type,
      message: text,
      ...(agentId ? { agentId } : {}),
      ...(payload ? { payload } : {}),
      ...(evidenceIds ? { evidenceIds } : {}),
    };
    investigation.events.push(event);
    onUpdate(event);
  };
  const context = () => ({
    query: investigation.query,
    requestedCompany,
    selectedCompany: investigation.company,
    researchGaps: [...researchGaps],
    agentOutputs: { ...outputs },
    ...(revision ? { bullRevision: revision } : {}),
  });
  const stage = async (
    id: AgentId,
    task: string,
    search = true,
    isRevision = false,
  ): Promise<AgentOutput | undefined> => {
    throwIfAborted(signal);
    let agent = investigation.agents.find((a) => a.id === id);
    if (!agent) {
      agent = { id, status: 'queued' };
      investigation.agents.push(agent);
    }
    agent.status = 'running';
    agent.startedAt ??= now();
    delete agent.error;
    const existingInput = agent.inputTokens || 0,
      existingOutput = agent.outputTokens || 0,
      existingSearches = agent.searches || 0;
    const startedAt = Date.now();
    emit(
      isRevision ? 'agent_revising' : 'agent_started',
      isRevision
        ? 'The Bull is revising the thesis using the Verifier’s findings.'
        : `${AGENTS.find((a) => a.id === id)!.name} started.`,
      id,
    );
    try {
      const result = await runClaudeAgent({
        namespace: isRevision ? 'bull-revision' : id,
        role: roles[id],
        task,
        context: context(),
        previousEvidence: [...investigation.evidence],
        budget,
        signal,
        search,
        requireSearch: id === 'verifier',
        onUsage: (input, output) => {
          investigation.totalInputTokens += input;
          investigation.totalOutputTokens += output;
          agent!.inputTokens = (agent!.inputTokens || 0) + input;
          agent!.outputTokens = (agent!.outputTokens || 0) + output;
        },
        onSearch: (count, sources) => {
          agent!.searches = (agent!.searches || 0) + count;
          emit(
            'search_completed',
            `${count} web search${count === 1 ? '' : 'es'} executed; ${sources.length} source URLs returned.`,
            id,
            { searches: count, sources },
          );
        },
      });
      throwIfAborted(signal);
      let output = result.output;
      if (id === 'verifier') {
        const freshUrls = new Set(
          result.retrievedSources.map((source) => canonicalUrl(source.url)),
        );
        const freshEvidenceIds = new Set(
          output.evidence
            .filter((evidence) => freshUrls.has(canonicalUrl(evidence.url)))
            .map((evidence) => evidence.id),
        );
        const citesFreshEvidence = output.findings.some((finding) =>
          finding.evidenceIds.some((evidenceId) => freshEvidenceIds.has(evidenceId)),
        );
        const gap =
          result.searches === 0
            ? 'No fresh web search was executed.'
            : !result.retrievedSources.length
              ? 'Fresh web search returned no usable source results.'
              : !citesFreshEvidence
                ? 'The verification findings cite no freshly retrieved source evidence.'
                : !output.verification
                  ? 'No explicit verification outcome was returned.'
                  : undefined;
        if (gap) {
          materialGap = true;
          researchGaps.push(gap);
          output = AgentOutputSchema.parse({
            ...output,
            verification: 'UNRESOLVED',
            confidence: 'LOW',
            summary: `${gap} The disputed claim remains unresolved.`,
            questions: [
              ...output.questions,
              'Repeat the verification with a successful independent source search, cited findings, and an explicit outcome.',
            ],
          });
        }
      }
      agent.status = 'completed';
      agent.completedAt = now();
      agent.output = output;
      agent.inputTokens = existingInput + result.inputTokens;
      agent.outputTokens = existingOutput + result.outputTokens;
      agent.searches = existingSearches + result.searches;
      investigation.evidence = combineEvidence(investigation.evidence, output.evidence);
      if (isRevision) revision = output;
      else outputs[id] = output;
      emit(
        isRevision ? 'thesis_revised' : 'agent_completed',
        isRevision
          ? output.revision || 'The Bull revised its thesis after independent verification.'
          : output.summary,
        id,
        {
          output,
          durationMs: Date.now() - startedAt,
          rejectedEvidence: result.rejectedEvidence,
          ...(isRevision ? { original: outputs.bull } : {}),
        },
        output.evidence.map((e) => e.id),
      );
      return output;
    } catch (error) {
      agent.status = 'failed';
      agent.completedAt = now();
      agent.error = message(error);
      // A later Bull revision must not erase the original Bull stage failure.
      materialGap = true;
      researchGaps.push(
        `${AGENTS.find((a) => a.id === id)!.name}${isRevision ? ' revision' : ''} failed: ${agent.error}`,
      );
      emit('agent_failed', agent.error, id);
      if (
        signal.aborted ||
        (error instanceof ResearchError &&
          ['NOT_CONFIGURED', 'HTTP_401', 'HTTP_403', 'TOKEN_BUDGET'].includes(error.code))
      )
        throw error;
      return undefined;
    }
  };
  const parallel = async (tasks: Promise<AgentOutput | undefined>[]) => {
    const results = await Promise.allSettled(tasks);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (rejected) throw rejected.reason;
  };
  try {
    emit(
      'investigation_started',
      'Live Claude investigation started. Every research stage uses a separate model call.',
    );
    await stage(
      'scout',
      'Investigate the user’s query. Find the strongest current signal supported by public sources. Establish its event date, specific change, and why now.',
    );
    await stage(
      'causal',
      'Analyze the Scout’s evidence and explain the causal path to new demand. Produce a causalChain with 3–5 links and explicit uncertainty.',
    );
    await stage(
      'hunter',
      'Use the signal and causal chain to find up to three relevant real companies, or assess the selected company if provided. Retrieve official domains, cite evidence, and explain company alignment. Include companies in your output.',
    );
    const candidates = [...(outputs.hunter?.companies || [])];
    const confidenceRank = { HIGH: 3, MEDIUM: 2, LOW: 1, INSUFFICIENT: 0 };
    const domain = (website: string) =>
      new URL(website).hostname.toLowerCase().replace(/^www\./, '');
    const selected = requestedCompany
      ? candidates.find(
          (company) =>
            company.name.toLowerCase() === requestedCompany.name.toLowerCase() &&
            domain(company.website) === domain(requestedCompany.website),
        )
      : candidates.sort(
          (a, b) =>
            b.evidenceIds.length - a.evidenceIds.length ||
            confidenceRank[b.confidence] - confidenceRank[a.confidence],
        )[0];
    if (selected) {
      investigation.company = selected;
      emit(
        'company_discovered',
        `${selected.name} selected for the company deep dive.`,
        'hunter',
        { company: selected },
        selected.evidenceIds,
      );
    } else {
      investigation.company = undefined;
      materialGap = true;
      companyIdentityGap = !!requestedCompany;
      const gap = requestedCompany
        ? `The requested company ${requestedCompany.name} and its supplied domain were not corroborated by Company Hunter. Company identity remains unknown.`
        : 'No company had enough retrieved evidence for a company-specific deep dive.';
      researchGaps.push(gap);
      emit('company_discovery_incomplete', gap, 'hunter');
    }
    await parallel([
      stage(
        'founder',
        investigation.company
          ? `Review ONLY the selected company ${investigation.company.name}. Research its publicly documented professional founder qualifications. Verify important career claims and state missing records.`
          : 'No company was identified from verified source URLs. Report UNKNOWN founder findings and the evidence needed; do not invent a company or founders.',
        !!investigation.company,
      ),
      stage(
        'competitive',
        investigation.company
          ? `Research competitors and substitutes ONLY for selected company ${investigation.company.name}. Test its claimed differentiation and deployment advantages.`
          : 'No company was identified. Assess market-level alternatives and explicitly state that company positioning is unknown.',
      ),
    ]);
    await parallel([
      stage(
        'bull',
        'Independently construct the strongest evidence-supported case for prioritizing this opportunity for venture research. Identify what must be true.',
      ),
      stage(
        'bear',
        'Independently challenge the research thesis. Select one material testable disputedClaim and explain how it could invalidate the opportunity.',
      ),
    ]);
    emit(
      'verification_started',
      'The Verifier is researching the Bull–Bear disagreement with fresh web search.',
      'verifier',
    );
    await stage(
      'verifier',
      `Run new web search to resolve the material disagreement. Bear's disputed claim: ${outputs.bear?.disputedClaim || outputs.bear?.summary || 'The thesis may not have enough independently verified commercial support.'} Return an explicit verification result and new evidence.`,
    );
    await stage(
      'bull',
      'This is a REQUIRED second pass after the Verifier. Read the original Bull position, the Bear challenge, and the Verifier result. State revision explicitly: what changed, what was withdrawn, what remains uncertain, and whether the thesis survives. Do not claim new facts without supplied evidence.',
      false,
      true,
    );
    const committee = await stage(
      'committee',
      'Make a final research prioritization assessment. Weigh source quality, unresolved disputes, causal uncertainty, actual company fit, and the revised Bull view. Include decision, confidence, and next research questions.',
      false,
    );
    throwIfAborted(signal);
    const hasEvidence = investigation.evidence.length > 0;
    investigation.decision =
      hasEvidence && !companyIdentityGap
        ? committee?.decision || 'INSUFFICIENT EVIDENCE'
        : 'INSUFFICIENT EVIDENCE';
    investigation.confidence =
      hasEvidence && !companyIdentityGap ? committee?.confidence || 'LOW' : 'INSUFFICIENT';
    const failed = investigation.agents.some((a) => a.status === 'failed');
    investigation.status =
      committee?.decision && hasEvidence && !failed && !materialGap
        ? 'completed'
        : hasEvidence
          ? 'partial'
          : 'failed';
    if (!hasEvidence)
      investigation.error =
        'No usable web evidence was retrieved. This run cannot substantiate a research assessment.';
    else if (failed)
      investigation.error =
        'Some research stages failed. Review the agent trace and remaining uncertainties before relying on this assessment.';
    else if (materialGap)
      investigation.error = `Required research remains incomplete. ${researchGaps.join(' ').slice(0, 600)}`;
    investigation.completedAt = now();
    emit(
      'investigation_completed',
      `${investigation.status === 'completed' ? 'Investigation complete' : 'Investigation finished with gaps'}: ${investigation.decision}.`,
      'committee',
      {
        status: investigation.status,
        decision: investigation.decision,
        confidence: investigation.confidence,
      },
    );
  } catch (error) {
    investigation.status = signal.aborted
      ? 'cancelled'
      : investigation.evidence.length
        ? 'partial'
        : 'failed';
    investigation.error = message(error);
    investigation.completedAt = now();
    for (const agent of investigation.agents)
      if (agent.status === 'running') {
        agent.status = 'failed';
        agent.error = investigation.error;
        agent.completedAt = now();
      }
    emit(
      signal.aborted ? 'investigation_cancelled' : 'investigation_failed',
      investigation.error,
      undefined,
      { status: investigation.status },
    );
  }
}

export async function scanSignals(
  sector: string,
  query?: string,
  signal?: AbortSignal,
): Promise<RadarData> {
  const budget = new TokenBudget(Number(process.env.RADAR_TOKEN_BUDGET) || 55_000);
  const task = `Sector: ${sector}. ${query ? `User research focus: ${query}.` : ''} Find up to three distinct, current signals relevant to emerging venture opportunities. Prioritize documented developments in the last 90 days when available. Use findings for the signals: title is the specific event, detail explains what changed and why it matters, evidenceIds reference retrieved sources. Each signal needs at least one actual retrieved source; return fewer if evidence is weak. Include causalChain describing demand effects. Do not fabricate current events or reuse generic industry themes as news.`;
  const scout = await runClaudeAgent({
    namespace: 'radar-scout',
    role: roles.scout,
    task,
    context: { sector, query },
    previousEvidence: [],
    budget,
    signal,
  });
  throwIfAborted(signal);
  if (!scout.output.evidence.length)
    throw new ResearchError(
      'The Scout could not retrieve evidence-backed signals. Try a more specific topic.',
      'NO_EVIDENCE',
    );
  let hunter: AgentOutput | undefined;
  let warning: string | undefined;
  try {
    const result = await runClaudeAgent({
      namespace: 'radar-hunter',
      role: roles.hunter,
      task: 'Find up to three real early-stage companies aligned to the supplied signals. Verify each official domain through web search. Include companies with evidenceIds, alignment, and uncertainty. The alignment MUST include the exact verbatim title of its related Scout finding. Reference related Scout evidence IDs as well as company evidence. State causal links without overstating proof.',
      context: { sector, query, scout: scout.output },
      previousEvidence: scout.output.evidence,
      budget,
      signal,
    });
    hunter = result.output;
  } catch (error) {
    if (signal?.aborted) throw error;
    warning = `Company discovery is incomplete: ${message(error)}`;
  }
  throwIfAborted(signal);
  const evidence = combineEvidence(scout.output.evidence, hunter?.evidence || []);
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));
  const signals = scout.output.findings
    .filter((f) => f.evidenceIds.some((id) => evidenceById.has(id)))
    .slice(0, 3)
    .map((finding, index) => {
      const ownEvidence = finding.evidenceIds
        .map((id) => evidenceById.get(id))
        .filter((e): e is Evidence => !!e);
      const companies = (hunter?.companies || [])
        .filter((company) => company.alignment.toLowerCase().includes(finding.title.toLowerCase()))
        .slice(0, 3);
      return SignalSchema.parse({
        id: `live-${randomUUID()}`,
        title: finding.title,
        sector,
        summary: finding.detail,
        whyNow: finding.detail,
        date: ownEvidence.find((e) => e.publishedAt)?.publishedAt || 'Publication date unknown',
        confidence:
          ownEvidence.length < 2 && scout.output.confidence === 'HIGH'
            ? 'MEDIUM'
            : scout.output.confidence,
        evidenceIds: finding.evidenceIds,
        sourceCount: new Set(ownEvidence.map((e) => e.url)).size,
        causalChain: index === 0 ? scout.output.causalChain || hunter?.causalChain || [] : [],
        companies,
        uncertainty:
          scout.output.questions[index] ||
          'Commercial consequences are research hypotheses. Validate demand, company fit, and source independence.',
      });
    });
  if (!signals.length)
    throw new ResearchError(
      'Retrieved sources did not support any structured signal.',
      'NO_SIGNALS',
    );
  return { signals, evidence, mode: 'live', updatedAt: now(), ...(warning ? { warning } : {}) };
}
