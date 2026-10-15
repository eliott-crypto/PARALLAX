import { randomUUID } from 'node:crypto';
import {
  BoardAssessmentSchema,
  type BoardAssessment,
  type BoardAgentId,
  type ThemeBoard,
  type BoardCandidate,
} from '../shared/boards.js';
import type { Company, Evidence } from '../shared/types.js';
import { MODEL, ResearchError, TokenBudget, runClaudeAgent, type AgentCall } from './claude.js';

const RANKING_METHOD =
  'Research priority: disclosed financing valuation relative to sourced commercial evidence, thesis fit and downside. Ordinal analyst judgement, not expected return or an executable buy price.';
const agentNames: Record<BoardAgentId, string> = {
  'scout-established': 'Infrastructure Scout',
  'scout-emerging': 'Emerging Scout',
  valuation: 'Price Verifier',
  bear: 'Adversarial Analyst',
  ranking: 'Ranking Committee',
};
export function createThemeBoard(title: string, thesis: string): ThemeBoard {
  const timestamp = new Date().toISOString();
  return {
    id: randomUUID(),
    title,
    thesis,
    status: 'draft',
    mode: 'live',
    createdAt: timestamp,
    updatedAt: timestamp,
    candidates: [],
    evidence: [],
    agents: (Object.keys(agentNames) as BoardAgentId[]).map((id) => ({
      id,
      name: agentNames[id],
      status: 'queued',
      searches: 0,
      inputTokens: 0,
      outputTokens: 0,
    })),
    events: [],
    summary: '',
    confidence: 'INSUFFICIENT',
    totalInputTokens: 0,
    totalOutputTokens: 0,
    rankingMethod: RANKING_METHOD,
  };
}

function moneyAmounts(text: string): number[] {
  const amounts: number[] = [];
  const pattern = /(?:US\s*)?\$\s*([\d,.]+)\s*(trillion|billion|million|bn|[bmt])?\b/gi;
  for (const match of text.matchAll(pattern)) {
    const number = Number(match[1].replaceAll(',', ''));
    const unit = match[2]?.toLowerCase();
    const multiplier =
      unit === 'trillion' || unit === 't'
        ? 1e12
        : unit === 'billion' || unit === 'bn' || unit === 'b'
          ? 1e9
          : unit === 'million' || unit === 'm'
            ? 1e6
            : 1;
    if (Number.isFinite(number)) amounts.push(number * multiplier);
  }
  return amounts;
}
function valuationAmounts(text: string): number[] {
  const money = String.raw`(?:US\s*)?\$\s*[\d,.]+\s*(?:trillion|billion|million|bn|[bmt])?\b`;
  const term = String.raw`(?:valu(?:ation|ed)|post[ -]money|pre[ -]money)`;
  const patterns = [
    new RegExp(`${term}[^$.;]{0,45}${money}`, 'gi'),
    new RegExp(`${money}[^$.;]{0,35}${term}`, 'gi'),
  ];
  return patterns.flatMap((pattern) =>
    [...text.matchAll(pattern)].flatMap((match) => moneyAmounts(match[0])),
  );
}
function dateSupported(asOf: string, sources: Evidence[]): boolean {
  const [year, month, day] = asOf.split('-');
  const parsedDate = new Date(`${asOf}${day ? '' : '-01'}T00:00:00Z`);
  if (
    !Number.isFinite(parsedDate.valueOf()) ||
    parsedDate.toISOString().slice(0, day ? 10 : 7) !== asOf ||
    (day && asOf > new Date().toISOString().slice(0, 10))
  )
    return false;
  const wantedMonth = Number(month) - 1;
  if (
    wantedMonth < 0 ||
    wantedMonth > 11 ||
    asOf.slice(0, 7) > new Date().toISOString().slice(0, 7)
  )
    return false;
  const monthName = new Date(Date.UTC(Number(year), wantedMonth)).toLocaleString('en-US', {
    month: 'long',
    timeZone: 'UTC',
  });
  return sources.some((source) => {
    const text = `${source.claim} ${source.summary}`;
    const published = source.publishedAt ? new Date(source.publishedAt) : undefined;
    if (
      day &&
      !(
        published &&
        Number.isFinite(published.valueOf()) &&
        published.toISOString().slice(0, 10) === asOf
      ) &&
      !text.includes(asOf)
    )
      return false;
    return (
      (published &&
        !Number.isNaN(published.valueOf()) &&
        published.getUTCFullYear() === Number(year) &&
        published.getUTCMonth() === wantedMonth) ||
      text.includes(asOf.slice(0, 7)) ||
      (new RegExp(`\\b${year}\\b`).test(text) &&
        new RegExp(`\\b${monthName.slice(0, 3)}(?:${monthName.slice(3)})?\\b`, 'i').test(text))
    );
  });
}

/** Reject unsourced pricing rather than fill five slots with attractive fiction. */
export function assembleCandidates(
  board: Pick<ThemeBoard, 'evidence'>,
  companies: Company[],
  raw: unknown[],
): BoardCandidate[] {
  const evidenceById = new Map(board.evidence.map((e) => [e.id, e]));
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const seen = new Set<string>();
  const candidates: BoardCandidate[] = [];
  for (const value of raw) {
    const parsed = BoardAssessmentSchema.safeParse(value);
    if (!parsed.success) continue;
    const candidate = parsed.data;
    const company = companyById.get(candidate.companyId);
    if (!company || seen.has(company.id)) continue;
    if (
      /\bpublicly[ -]traded\b|\b(?:listed|trading) on (?:the )?(?:NASDAQ|NYSE)\b|\bacquired by\b/i.test(
        company.description,
      )
    )
      continue;
    const refs = candidate.evidenceIds.filter((id) => evidenceById.has(id));
    const valuationSources = candidate.valuation.evidenceIds
      .map((id) => evidenceById.get(id))
      .filter(
        (e): e is Evidence =>
          !!e &&
          e.status === 'SUPPORTED' &&
          ['OFFICIAL_DOCUMENT', 'FIRST_PARTY_COMPANY_CLAIM', 'INDEPENDENT_REPORT'].includes(e.type),
      );
    const matching = valuationSources.filter((source) => {
      const text = `${source.claim} ${source.summary}`;
      const attributed =
        source.company?.toLowerCase() === company.name.toLowerCase() ||
        text.toLowerCase().includes(company.name.toLowerCase());
      const priceClauses = [source.claim, source.summary].flatMap((part) => part.split(/;|\.\s+/));
      return (
        attributed &&
        priceClauses.some(
          (part) =>
            !/\bin talks\b|\bseeking\b|\bclosing in on\b|\bnearing\b|\bproposed\b|\btargeting\b/i.test(
              part,
            ) &&
            valuationAmounts(part).some(
              (amount) =>
                Math.abs(amount - candidate.valuation.amountUsd) <=
                candidate.valuation.amountUsd * 0.00001,
            ),
        )
      );
    });
    if (!refs.length || !matching.length || !dateSupported(candidate.valuation.asOf, matching))
      continue;
    seen.add(company.id);
    candidates.push({
      ...candidate,
      evidenceIds: [...new Set([...refs, ...matching.map((e) => e.id)])],
      valuation: { ...candidate.valuation, evidenceIds: matching.map((e) => e.id) },
      company,
    });
  }
  return candidates
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 5)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

const discipline =
  'Private startups only. Disclosed historical financing valuation is not a current quote or a right to buy shares. No invented ARR, margin, entry price, success probability, price targets or valuation multiples. Distinguish investment attractiveness from research priority. First-party traction is a company claim. No customer logo inference. Findings should be concise and cite validated evidence. For financing evidence put company name, explicit USD valuation, month/year and whether post-money or unknown basis in claim/summary. Do not confuse funding amount with valuation. Avoid unrelated conglomerates, public stocks and acquired companies.';

export async function runThemeBoard(
  board: ThemeBoard,
  onUpdate: (board: ThemeBoard) => void | Promise<void>,
  signal?: AbortSignal,
  agentRunner: typeof runClaudeAgent = runClaudeAgent,
): Promise<void> {
  if (board.candidates.length)
    board.previousRanking = {
      capturedAt: board.updatedAt,
      candidates: structuredClone(board.candidates),
      evidence: structuredClone(board.evidence),
      summary: board.summary,
      totalInputTokens: board.totalInputTokens,
      totalOutputTokens: board.totalOutputTokens,
    };
  board.status = 'running';
  board.agents = (Object.keys(agentNames) as BoardAgentId[]).map((id) => ({
    id,
    name: agentNames[id],
    status: 'queued',
    searches: 0,
    inputTokens: 0,
    outputTokens: 0,
  }));
  board.evidence = [];
  board.candidates = [];
  board.summary = '';
  board.confidence = 'INSUFFICIENT';
  board.error = undefined;
  board.totalInputTokens = 0;
  board.totalOutputTokens = 0;
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(
    () => controller.abort(new Error('Theme research reached its ten-minute limit.')),
    600_000,
  );
  const budget = new TokenBudget(Number(process.env.MAX_THEME_TOKENS) || 240_000);
  let pending: Promise<void> = Promise.resolve();
  const publish = () => {
    board.updatedAt = new Date().toISOString();
    pending = pending.then(() => onUpdate(board));
    return pending;
  };
  const event = (
    agentId: BoardAgentId | undefined,
    type: ThemeBoard['events'][number]['type'],
    message: string,
  ) => {
    board.events.push({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      agentId,
      type,
      message,
    });
  };
  const execute = async (id: BoardAgentId, task: string, context: unknown, search = true) => {
    const agent = board.agents.find((value) => value.id === id)!;
    agent.status = 'running';
    agent.startedAt = new Date().toISOString();
    event(id, 'started', `${agent.name} started.`);
    await publish();
    try {
      const options: AgentCall = {
        namespace: `theme-${id}`,
        role: agent.name,
        task: `${discipline}\n\n${task}`,
        context: {
          title: board.title,
          thesis: board.thesis,
          researchDate: new Date().toISOString().slice(0, 10),
          data: context,
        },
        previousEvidence: [...board.evidence],
        budget,
        signal: controller.signal,
        search,
        boardResearch: true,
        maxSearches: 4,
        requireSearch: search,
        ...(id === 'ranking'
          ? { model: process.env.ANTHROPIC_COMMITTEE_MODEL?.trim() || MODEL() }
          : {}),
        onSearch: (count, sources) => {
          agent.searches += count;
          event(
            id,
            'search',
            `${agent.name}: ${count} real search${count === 1 ? '' : 'es'}, ${sources.length} retrieved pages.`,
          );
          void publish();
        },
        onUsage: (input, output) => {
          agent.inputTokens += input;
          agent.outputTokens += output;
          board.totalInputTokens += input;
          board.totalOutputTokens += output;
        },
      };
      const result = await agentRunner(options);
      agent.status = 'completed';
      agent.completedAt = new Date().toISOString();
      agent.output = result.output;
      agent.model = result.model;
      // Tests and alternative providers may only report final usage, without callbacks.
      if (!agent.inputTokens && !agent.outputTokens) {
        agent.inputTokens = result.inputTokens;
        agent.outputTokens = result.outputTokens;
        board.totalInputTokens += result.inputTokens;
        board.totalOutputTokens += result.outputTokens;
      }
      if (!agent.searches) agent.searches = result.searches;
      const known = new Set(board.evidence.map((e) => e.id));
      board.evidence.push(...result.output.evidence.filter((e) => !known.has(e.id)));
      event(id, 'completed', `${agent.name} completed: ${result.output.summary}`);
      await publish();
      return result.output;
    } catch (error) {
      agent.status = 'failed';
      agent.completedAt = new Date().toISOString();
      agent.error = error instanceof Error ? error.message : 'Research failed.';
      event(id, 'failed', `${agent.name}: ${agent.error}`);
      await publish();
      throw error;
    }
  };
  try {
    await publish();
    await Promise.allSettled([
      execute(
        'scout-established',
        'Find up to 3 established private infrastructure startups benefiting directly from this thesis, with disclosed closed financing valuations. Prefer differentiated providers with commercial proof. You have up to FOUR searches: use one focused discovery query, then one focused official-domain query for EACH of the three named companies. Prioritise actual company financing announcements; company press/blog pages can establish identity AND valuation. Do not spend every query on media roundups or valuation aggregators. Search each discovered company by name plus official funding announcement and website, and retrieve its official domain before returning. Domain proof is mandatory: return companies with their retrieved official website (copy its exact scheme and host, including www if present), supported identity evidence IDs, disclosed valuation/date in funding, and concise strengths/unknowns. The other scout covers earlier-stage companies; find distinct established businesses. Use up to 8 evidence records, ideally one financing announcement and one official product page per company. Financing claim/summary must explicitly associate company name with the USD valuation and month/year. Distinguish CLOSED rounds from negotiations; if newer talks are unclosed, use the last confirmed closed round with its date. Keep each evidence claim/summary under 25 words, each company description/alignment/uncertainty under 20 words, at most 2 strengths each, and only 3 short findings. Return the companies array: do not omit all company identities before using the reserved official-domain searches. No ranking yet.',
        {},
      ),
      execute(
        'scout-emerging',
        'Independently find up to 3 emerging, earlier-stage private startups benefiting from this thesis with disclosed CLOSED financing valuations. Prioritise smaller disclosed valuations plus credible product evidence; cheaper alone is not better. Avoid the largest category leaders covered by the other scout. You have up to FOUR searches: one discovery query, then a focused official-domain/financing query for EACH discovered company. Prefer primary funding announcements on company press/blog pages, rather than funding aggregators. Do not consume every search on media roundups. Search each candidate company by name plus official website and funding announcement, and retrieve its official domain before returning. Return companies with their retrieved official website (copy its exact scheme and host, including www if present), supported identity evidence IDs, concise strengths/unknowns, and disclosed valuation/date in funding. Use up to 8 evidence records, ideally one financing announcement and one official product page per company. Financing claim/summary must explicitly associate company name with USD valuation and month/year. A reported proposed round is not closed; prefer the last confirmed closed round if latest negotiations are unconfirmed. Keep evidence claim/summary under 25 words, company description/alignment/uncertainty under 20 words, at most 2 strengths each, and 3 short findings. Return the companies array: do not omit all identities before using the reserved official-domain searches. No ranking yet.',
        {},
      ),
    ]);
    const companyMap = new Map<string, Company>();
    const domains = new Set<string>();
    for (const agent of board.agents)
      for (const company of agent.output?.companies || []) {
        const domain = new URL(company.website).hostname.replace(/^www\./, '');
        if (!domains.has(domain)) {
          domains.add(domain);
          companyMap.set(company.id, company);
        }
      }
    const companies = [...companyMap.values()];
    if (!companies.length)
      throw new ResearchError(
        'The scouts found no companies with admissible sources. No ranking was fabricated.',
        'NO_CANDIDATES',
      );
    await Promise.allSettled([
      execute(
        'valuation',
        'Independently check the disclosed financing valuations for these candidate companies. Search for newer funding rounds, USD amount versus money raised, financing date and pre/post-money basis. Return up to 8 NEW evidence records that resolve pricing gaps for every candidate. Include exact company name, disclosed USD valuation and month/year in valuation claim/summary; use status SUPPORTED only if the source explicitly states it. Findings should identify stale valuations, ambiguous basis and missing data. Return corrections for existing evidence that is demonstrably wrong; never silently upgrade a claim. Confirm that the round CLOSED: in talks, seeking, nearing, closing in on, or proposed valuation is not an established financing mark. If a newer proposed round is unclosed, retain the last verified closed round with its historical date and explicitly flag the newer negotiations. Do not assert valuation is currently available to an investor. Keep source claim/summary under 25 words.',
        { companies },
      ),
      execute(
        'bear',
        'Challenge these companies for this thematic thesis using fresh research. Find the strongest disconfirming facts: public/acquired status, commercial weak points, competition, financing ambiguity, first-party-only traction, or a thesis that benefits everyone. Provide one practical kill criterion and next proof per candidate where evidence permits. Do not equate missing evidence with a negative fact. Return corrections only where a cited earlier claim is directly contradicted.',
        { companies },
      ),
    ]);
    // Explicit, downward-only corrections remain visible on the original source records.
    for (const agent of board.agents.filter((a) => a.id === 'valuation' || a.id === 'bear')) {
      for (const correction of agent.output?.corrections || []) {
        const evidence = board.evidence.find((entry) => entry.id === correction.evidenceId);
        if (
          evidence &&
          { SUPPORTED: 0, PARTIAL: 1, UNVERIFIED: 2, CONTRADICTED: 3 }[correction.status] >=
            { SUPPORTED: 0, PARTIAL: 1, UNVERIFIED: 2, CONTRADICTED: 3 }[evidence.status]
        ) {
          evidence.status = correction.status;
          evidence.correction = correction.reason;
          evidence.reviewedAt = new Date().toISOString();
        }
      }
    }
    const output = await execute(
      'ranking',
      `Rank up to 5 of the supplied companies for further venture diligence. Include only real, still-private companies with explicit, sourced USD financing valuation and month/year. Five is a maximum, not a quota. Never invent a valuation to fill a slot. Synthesis only; no new evidence or searches. Compare relative valuation against sourced commercial proof and risk, not absolute cheapness. Unknown traction cannot justify RELATIVE VALUE. Use LOW confidence when evidence is thin or old. Put exact structured results in optional shortlist (not in findings). Each shortlist item must match this schema: ${JSON.stringify({ companyId: 'exact existing company id', rank: 1, rationale: 'why this deserves attention now', valuation: { amountUsd: 1500000000, asOf: 'YYYY-MM or YYYY-MM-DD', label: 'historical disclosed financing valuation', round: 'round name if disclosed, otherwise Undisclosed round', basis: 'POST_MONEY | PRE_MONEY | UNDISCLOSED_BASIS', evidenceIds: ['existing ids explicitly stating amount and month/year'] }, priceSignal: 'RELATIVE VALUE | MIXED | EXPENSIVE', priceReason: 'supported peer comparison; unknowns explicit', bullCase: 'reasoned upside mechanism', bearCase: 'best adversarial objection', killCriterion: 'falsifiable event that breaks this thesis', nextProof: 'one thing to verify next', confidence: 'HIGH | MEDIUM | LOW | INSUFFICIENT', evidenceIds: ['existing ids'] })}. Keep every shortlist narrative field under 25 words so all five fit in the output budget. Summary should state the strongest research conclusion and limitations. Evidence:[]; use normal concise findings separately. Source-backed values only: server will reject unsupported prices/dates. A financing announcement can be primary evidence of a company claim without proving realised business performance.`,
      {
        companies,
        agents: board.agents
          .filter((a) => a.output)
          .map((a) => ({
            id: a.id,
            summary: a.output!.summary,
            findings: a.output!.findings,
            questions: a.output!.questions,
          })),
      },
      false,
    );
    const assessments =
      (output as typeof output & { shortlist?: BoardAssessment[] }).shortlist || [];
    board.candidates = assembleCandidates(board, companies, assessments);
    board.summary = output.summary;
    board.confidence = board.candidates.length ? output.confidence : 'INSUFFICIENT';
    const failed = board.agents.filter((a) => a.status === 'failed');
    board.status = board.candidates.length
      ? failed.length || board.candidates.length < 5
        ? 'partial'
        : 'completed'
      : 'partial';
    if (board.candidates.length < 5)
      board.error = `Only ${board.candidates.length} companies met the disclosed-valuation evidence threshold. Missing slots were not filled.`;
    if (failed.length)
      board.error = `${board.error ? `${board.error} ` : ''}${failed.map((a) => a.name).join(', ')} could not finish; inspect the agent trail.`;
    event(
      undefined,
      'ranking',
      `${board.candidates.length} sourced candidates ranked. ${RANKING_METHOD}`,
    );
  } catch (error) {
    board.status = controller.signal.aborted
      ? 'cancelled'
      : board.evidence.length
        ? 'partial'
        : 'failed';
    board.error = error instanceof Error ? error.message : 'Theme research failed.';
    if (controller.signal.aborted)
      board.error = signal?.aborted
        ? 'Theme research cancelled. Completed research is preserved.'
        : 'Theme research reached its ten-minute limit. Completed research is preserved.';
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
    for (const agent of board.agents)
      if (agent.status === 'running') {
        agent.status = 'failed';
        agent.error = board.error || 'Research stopped.';
      }
    await publish();
  }
}
