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
  'scout-established': 'Niche Specialist Scout',
  'scout-emerging': 'Cross-sector Scout',
  valuation: 'Price Verifier',
  bear: 'Adversarial Analyst',
  ranking: 'Ranking Committee',
  'scout-gap': 'Gap Scout',
  'valuation-gap': 'Gap Price Verifier',
  'bear-gap': 'Gap Adversarial Analyst',
  'ranking-gap': 'Gap Ranking Committee',
  'scout-replacement': 'Priced Replacement Scout',
  'valuation-replacement': 'Replacement Price Verifier',
  'bear-replacement': 'Replacement Adversarial Analyst',
  'ranking-replacement': 'Replacement Ranking Committee',
  identity: 'Company Identity Resolver',
  'identity-extra': 'Additional Identity Resolver',
};
const coreAgentIds: BoardAgentId[] = [
  'scout-established',
  'scout-emerging',
  'valuation',
  'bear',
  'ranking',
];
const gapAgentIds: BoardAgentId[] = ['scout-gap', 'valuation-gap', 'bear-gap', 'ranking-gap'];
const replacementAgentIds: BoardAgentId[] = [
  'scout-replacement',
  'valuation-replacement',
  'bear-replacement',
  'ranking-replacement',
];
export function createThemeBoard(
  title: string,
  thesis: string,
  preferredValuationMaxUsd = 100_000_000,
): ThemeBoard {
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
    agents: coreAgentIds.map((id) => ({
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
    preferredValuationMaxUsd,
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
function isNonPriceInstrument(text: string): boolean {
  return (
    /\bvaluation[ -]caps?\b|\bconvertible (?:notes?|securit(?:y|ies)|instruments?)\b|\bsimple agreement for future equity\b|\basking (?:price|valuation)\b|\b(?:aspirational|fundraising) (?:target|valuation)\b/i.test(
      text,
    ) ||
    /\bSAFE\b/.test(text) ||
    /\b(?:post[ -]money|pre[ -]money) safe\b|\bsafe (?:agreement|financing|note|round|instrument)\b/i.test(
      text,
    )
  );
}
function valuationAmounts(text: string): number[] {
  if (isNonPriceInstrument(text)) return [];
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

function companyAliases(company: Company): string[] {
  const aliases = [company.name];
  const suffix = company.name.match(/^(.+?)\s+\(([a-z0-9.-]+)\)$/i);
  const domain = new URL(company.website).hostname.toLowerCase().replace(/^www\./, '');
  if (suffix && suffix[2].toLowerCase().replace(/^www\./, '') === domain)
    aliases.push(suffix[1].trim());
  return [...new Set(aliases)];
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
      if (isNonPriceInstrument(text)) return false;
      const attributed = companyAliases(company).some(
        (name) =>
          source.company?.toLowerCase() === name.toLowerCase() ||
          text.toLowerCase().includes(name.toLowerCase()),
      );
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
  'Private startups only. Disclosed historical financing valuation is not a current quote or a right to buy shares. No invented ARR, margin, entry price, success probability, price targets or valuation multiples. Distinguish investment attractiveness from research priority. First-party traction is a company claim. No customer logo inference. Findings should be concise and cite validated evidence. For financing evidence put company name, explicit USD valuation, month/year and whether post-money or unknown basis in claim/summary. Do not confuse funding amount with valuation. Only disclosed closed-round company valuations count; a reputable independent report can support an explicitly attributed reported valuation without company confirmation. Unknown instrument type alone does not prove a SAFE cap. Keep reported price confidence and attribution explicit. Exclude positive evidence of caps or asking prices: SAFE valuation caps, convertible-note caps, issuer asking prices and aspirational fundraising targets are not company valuations. Keep those as unpriced leads with the instrument limitation explicit. Avoid unrelated conglomerates, public stocks and acquired companies.';

export async function runThemeBoard(
  board: ThemeBoard,
  onUpdate: (board: ThemeBoard) => void | Promise<void>,
  signal?: AbortSignal,
  agentRunner: typeof runClaudeAgent = runClaudeAgent,
  options: {
    fillGaps?: boolean;
    replacement?: boolean;
    resolveIdentities?: boolean;
    identityExtra?: boolean;
  } = {},
): Promise<void> {
  const identityExtra = options.identityExtra === true;
  const replacement = options.replacement === true || identityExtra;
  const identityResolution = options.resolveIdentities === true || identityExtra;
  const fillGaps = options.fillGaps === true || replacement || identityResolution;
  const recoveryIds: BoardAgentId[] = identityResolution
    ? identityExtra
      ? ['identity-extra', 'valuation-replacement', 'bear-replacement', 'ranking-replacement']
      : ['identity', 'valuation-gap', 'bear-gap', 'ranking-gap']
    : replacement
      ? replacementAgentIds
      : gapAgentIds;
  const [recoveryScoutId, recoveryValuationId, recoveryBearId, recoveryRankingId] = recoveryIds;
  const startingCandidates = structuredClone(board.candidates);
  if (fillGaps && board.agents.some((agent) => agent.id === recoveryScoutId))
    throw new ResearchError(
      'This research cycle already used its bounded recovery pass. Refresh the theme for a fresh cycle.',
      'GAP_LIMIT',
    );
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
  const makeAgent = (id: BoardAgentId) => ({
    id,
    name: agentNames[id],
    status: 'queued' as const,
    searches: 0,
    inputTokens: 0,
    outputTokens: 0,
  });
  if (fillGaps)
    board.agents.push(
      ...recoveryIds.filter((id) => !board.agents.some((agent) => agent.id === id)).map(makeAgent),
    );
  else {
    board.agents = coreAgentIds.map(makeAgent);
    board.evidence = [];
    board.candidates = [];
    board.unpricedCompanies = [];
    board.summary = '';
    board.confidence = 'INSUFFICIENT';
    board.totalInputTokens = 0;
    board.totalOutputTokens = 0;
  }
  board.mode = 'live';
  board.error = undefined;
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(
    () => controller.abort(new Error('Theme research reached its ten-minute limit.')),
    600_000,
  );
  const budget = new TokenBudget(
    Math.min(800_000, Math.max(100_000, Number(process.env.MAX_THEME_TOKENS) || 600_000)),
  );
  if (fillGaps) budget.used = board.totalInputTokens + board.totalOutputTokens;
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
        task: `${discipline}\n\n${board.preferredValuationMaxUsd ? `NICHE DISCOVERY MANDATE: Prefer specialist, less obvious private startups with disclosed valuations at or below $${board.preferredValuationMaxUsd.toLocaleString('en-US')}. This is a preference, not permission to invent prices or force a result. If the preferred range has too little evidence, allow clearly labelled larger comparisons up to 5x the preference. Avoid famous multi-billion-dollar AI vendors as default picks. Seek varied product/sector exposures connected to the actual theme, not unrelated diversification. A low valuation alone is never proof of value. ` : ''}${task}`,
        context: {
          title: board.title,
          thesis: board.thesis,
          researchDate: new Date().toISOString().slice(0, 10),
          preferredValuationMaxUsd: board.preferredValuationMaxUsd ?? null,
          data: context,
        },
        previousEvidence: [...board.evidence],
        budget,
        signal: controller.signal,
        search,
        boardResearch: true,
        maxSearches:
          id === 'identity-extra' ||
          id.startsWith('bear') ||
          (replacement && id.startsWith('valuation'))
            ? 2
            : 4,
        requireSearch: search,
        ...(id.startsWith('ranking')
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
    if (!fillGaps)
      await Promise.allSettled([
        execute(
          'scout-established',
          'Find up to 3 niche private specialist companies directly benefiting from this thesis, prioritising small disclosed CLOSED financing valuations within the preferred range. Prefer specific products serving a neglected customer workflow, clear causal fit, and emerging commercial proof. Avoid the most famous AI infrastructure vendors. If no small disclosed marks can be sourced, report the gap; unknown valuation is an unpriced research lead, not a ranked price. You have up to FOUR searches: use one focused discovery query, then one focused official-domain query for EACH of the three named companies. Prioritise actual company financing announcements; company press/blog pages can establish identity AND valuation. Do not spend every query on media roundups or valuation aggregators. Search each discovered company by name plus official funding announcement and website, and retrieve its official domain before returning. Domain proof is mandatory: return companies with their retrieved official website (copy its exact scheme and host, including www if present), supported identity evidence IDs, disclosed valuation/date in funding, and concise strengths/unknowns. The other scout searches adjacent sectors; find distinct specialist companies. In findings explain one recent source-backed world change that helps the niche, the specific new customer need and the weakest link in that causal argument. A macro change can be factual while company upside remains a hypothesis. Use up to 8 evidence records, ideally one financing announcement and one official product page per company. Financing claim/summary must explicitly associate company name with the USD valuation and month/year. Distinguish CLOSED rounds from negotiations; if newer talks are unclosed, use the last confirmed closed round with its date. Keep each evidence claim/summary under 25 words, each company description/alignment/uncertainty under 20 words, at most 2 strengths each, and only 3 short findings. Return the companies array: do not omit all company identities before using the reserved official-domain searches. No ranking yet.',
          {},
        ),
        execute(
          'scout-emerging',
          'Independently find up to 3 less obvious private companies in DIFFERENT product niches or sectors exposed to this thesis, with small disclosed CLOSED financing valuations. Look beyond generic AI vendors: choose relevant specialist workflows in industrial software, energy, regulated industries, developer tools or other sectors only where the thesis creates a specific customer need. Keep the theme-to-company causal fit strong; do not select unrelated businesses to fill a diversity quota. Prioritise the preferred valuation range; if evidence is scarce show unpriced leads honestly and label larger comparisons. Cheaper alone is not better. Avoid famous category leaders. In findings trace a recent source-backed change to a new customer need, the company fit and the weakest link. You have up to FOUR searches: one discovery query, then a focused official-domain/financing query for EACH discovered company. Prefer primary funding announcements on company press/blog pages, rather than funding aggregators. Do not consume every search on media roundups. Search each candidate company by name plus official website and funding announcement, and retrieve its official domain before returning. Return companies with their retrieved official website (copy its exact scheme and host, including www if present), supported identity evidence IDs, concise strengths/unknowns, and disclosed valuation/date in funding. Use up to 8 evidence records, ideally one financing announcement and one official product page per company. Financing claim/summary must explicitly associate company name with USD valuation and month/year. A reported proposed round is not closed; prefer the last confirmed closed round if latest negotiations are unconfirmed. Keep evidence claim/summary under 25 words, company description/alignment/uncertainty under 20 words, at most 2 strengths each, and 3 short findings. Return the companies array: do not omit all identities before using the reserved official-domain searches. No ranking yet.',
          {},
        ),
      ]);
    const existing = new Map<string, Company>();
    for (const agent of board.agents)
      for (const company of agent.output?.companies || [])
        existing.set(new URL(company.website).hostname.replace(/^www\./, ''), company);
    if (!identityResolution && (fillGaps || existing.size < 5)) {
      if (!board.agents.some((agent) => agent.id === recoveryScoutId))
        board.agents.push(makeAgent(recoveryScoutId));
      event(
        recoveryScoutId,
        'started',
        `Autonomous gap recovery: ${existing.size} distinct sourced companies, seeking up to ${Math.min(3, Math.max(0, 5 - (replacement ? startingCandidates.length : existing.size)))} additional candidates. Earlier research is retained.`,
      );
      await publish();
      try {
        await execute(
          recoveryScoutId,
          `${replacement ? 'REPLACEMENT PASS: The prior committee could price only ' + startingCandidates.length + ' companies. Raw company identities do NOT count toward five. Find up to 3 new candidates with independently supported CLOSED USD valuations to fill ' + Math.max(0, 5 - startingCandidates.length) + ' actual priced slots. Unpriced companies already rejected for no disclosed valuation are not valid substitutes. Repair an ambiguous valuation only by fresh source retrieval and a narrowly supported claim; do not upgrade historical evidence statuses. ' : ''}Close the company-discovery gap in this theme. Find up to 3 DISTINCT additional NICHE private companies with CLOSED publicly disclosed USD financing valuations, preferring the configured valuation ceiling and different relevant product exposures over famous AI vendors. Do not repeat the existing company domains. Use earlier scout findings as research leads, not verified company identities; omitted companies may only need an official-domain lookup or a closed-round source. Prefer relevant companies with primary financing announcements. You have FOUR searches: one targeted discovery query and up to three company-specific official-domain/funding queries. If inference providers are saturated, explore adjacent infrastructure bottlenecks directly implied by the theme, such as browser execution, agent sandboxes or developer tooling, explaining the causal fit. Never add unrelated companies just to reach five. Retrieve an official company domain and a valuation source before returning each company; website must copy exact scheme/host from the result. Return up to 3 companies and 8 compact evidence records. Each valuation claim must bind the company name, exact USD valuation and month/year; distinguish money raised, negotiations and actual closed-round valuation. Company metadata and source summaries under 25 words. No hypothetical prices or filler. A lead is not a candidate until its identity and disclosed valuation are sourced.`,
          {
            existingCompanies: [...existing.values()],
            externalResearchLeads: {
              note: 'Diagnostic research leads from external review, not yet admitted Claude evidence. Retrieve each relevant URL through actual web_search before citing it. Do not add an evidence record merely because its URL appears in this context.',
              leads: board.researchLeads || [],
            },
            previouslyResearchedCandidates: {
              note: 'Previously researched candidates from other user themes; recheck thematic fit and price freshness with actual fresh search. Their source records retain their historical retrievedAt; source reuse is not a new retrieval.',
              companies: board.relatedCompanies || [],
            },
            missingSlots: Math.max(
              0,
              5 - (replacement ? startingCandidates.length : existing.size),
            ),
            existingPricedCandidates: startingCandidates.map((candidate) => ({
              companyId: candidate.companyId,
              name: candidate.company.name,
              valuation: candidate.valuation,
            })),
            discoveryLeads: board.agents
              .filter((agent) => agent.output)
              .map((agent) => ({
                agent: agent.id,
                findings: agent.output!.findings,
                questions: agent.output!.questions,
              })),
          },
        );
      } catch {
        /* The original sourced candidates remain usable when bounded recovery fails. */
      }
    }
    const identityKnownDomains = new Set(
      board.agents
        .flatMap((agent) => agent.output?.companies || [])
        .map((company) => new URL(company.website).hostname.replace(/^www\./, '')),
    );
    const identityKnownNames = new Set(
      board.agents
        .flatMap((agent) => agent.output?.companies || [])
        .flatMap((company) => companyAliases(company).map((name) => name.toLowerCase())),
    );
    const pricedLeads = new Map<
      string,
      {
        name: string;
        amountUsd: number;
        evidenceIds: string[];
        evidence: Evidence[];
        reported: boolean;
      }
    >();
    for (const source of board.evidence) {
      if (
        !source.company ||
        source.status === 'CONTRADICTED' ||
        isNonPriceInstrument(`${source.claim} ${source.summary}`)
      )
        continue;
      const amounts = valuationAmounts(source.claim);
      if (
        !amounts.length ||
        /\bin talks\b|\bseeking\b|\bproposed\b|\bnearing\b/i.test(source.claim)
      )
        continue;
      for (const name of source.company
        .split(/;/)
        .map((value) => value.trim())
        .filter(Boolean)) {
        if (identityKnownNames.has(name.toLowerCase())) continue;
        const prior = pricedLeads.get(name.toLowerCase());
        if (prior) {
          prior.evidenceIds.push(source.id);
          prior.evidence.push(source);
        } else
          pricedLeads.set(name.toLowerCase(), {
            name,
            amountUsd: Math.min(...amounts),
            evidenceIds: [source.id],
            evidence: [source],
            reported: source.type === 'INDEPENDENT_REPORT',
          });
      }
    }
    const identityPasses: BoardAgentId[] = identityExtra
      ? ['identity-extra']
      : ['identity', 'identity-extra'];
    for (const identityId of identityPasses) {
      const knownCompanies = board.agents.flatMap((agent) => agent.output?.companies || []);
      const knownNames = new Set(
        knownCompanies.flatMap((company) =>
          companyAliases(company).map((name) => name.toLowerCase()),
        ),
      );
      const knownDomains = new Set(
        knownCompanies.map((company) => new URL(company.website).hostname.replace(/^www\./, '')),
      );
      const leads = [...pricedLeads.values()]
        .filter(
          (lead) =>
            !knownNames.has(lead.name.toLowerCase()) &&
            (!board.preferredValuationMaxUsd ||
              lead.amountUsd <= board.preferredValuationMaxUsd * 5),
        )
        .sort((a, b) => {
          const withinA = board.preferredValuationMaxUsd
            ? a.amountUsd <= board.preferredValuationMaxUsd
            : true;
          const withinB = board.preferredValuationMaxUsd
            ? b.amountUsd <= board.preferredValuationMaxUsd
            : true;
          return Number(withinB) - Number(withinA) || a.amountUsd - b.amountUsd;
        })
        .slice(0, identityId === 'identity-extra' ? 2 : 3);
      if (
        !leads.length ||
        knownDomains.size >= 5 ||
        board.agents.some((agent) => agent.id === identityId && agent.status !== 'queued')
      )
        continue;
      if (identityId === 'identity-extra' && budget.limit - budget.used < 35_000) {
        event(
          undefined,
          'ranking',
          'Additional identity lookup skipped because the remaining token allowance is too small. Existing research is preserved.',
        );
        continue;
      }
      if (!board.agents.some((agent) => agent.id === identityId))
        board.agents.push(makeAgent(identityId));
      try {
        await execute(
          identityId,
          `Resolve ONLY the official identities of the supplied named priced research leads. Do not discover another set of financing stories or search general startup roundups. Funding evidence was already retrieved; use your ${identityId === 'identity-extra' ? 'TWO' : 'FOUR'} searches for exact company-name + official-site/product lookup, one per named lead. Retrieve each official company domain as an actual search result. Disambiguate common names against the supplied product, founder, funding date and investor descriptions. For each resolved company return companies with website copied from the exact retrieved scheme/host, concise product/category/alignment, uncertainty and prior funding evidenceIds PLUS the new official identity source. Return up to ${identityId === 'identity-extra' ? '2' : '3'} companies, up to 4 new official identity evidence entries, and 3 concise findings. Use a clean company name; do not append website domains to the name. You may resolve a company whose valuation remains reported or uncertain; identity discovery does not establish its price. No invented domains or inferred identities. Do not omit a known company merely because its financing valuation was an independently reported figure rather than company-confirmed: preserve that attribution for the Price Verifier. Unknown instrument basis is a question, not proof of a SAFE cap. Reuse prior financial citations rather than spending searches re-finding them.`,
          {
            namedLeads: leads,
            existingCompanyDomains: [...knownDomains],
            researchLeads: board.researchLeads || [],
            rationale:
              'Previous discovery found financing sources but no retrieved official company domains. This is bounded identity-only recovery; no valuation is admitted solely from this context.',
          },
        );
      } catch {
        /* Preserve earlier financial research when bounded identity lookup fails. */
      }
    }
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
    const valuationId: BoardAgentId = fillGaps ? recoveryValuationId : 'valuation';
    const bearId: BoardAgentId = fillGaps ? recoveryBearId : 'bear';
    const rankingId: BoardAgentId = fillGaps ? recoveryRankingId : 'ranking';
    const priorPricedIds = new Set(startingCandidates.map((candidate) => candidate.companyId));
    const reviewCompanies = replacement
      ? companies.filter((company) => !priorPricedIds.has(company.id))
      : companies;
    await Promise.allSettled([
      execute(
        valuationId,
        `${replacement ? 'Focus ONLY on newly discovered or previously unpriced candidates; do not spend searches rechecking the already priced set. Two focused searches maximum. Narrow the claim to the exact reported USD amount and financing month; unknown pre/post-money basis belongs in UNDISCLOSED_BASIS, not a claim that the amount itself is unsupported. Mark SUPPORTED only where the retrieved text explicitly states that narrow claim, otherwise preserve uncertainty. ' : ''}Independently check the disclosed financing valuations for these candidate companies. Search for newer funding rounds, USD amount versus money raised, financing date and pre/post-money basis. Return up to 8 NEW evidence records that resolve pricing gaps for every candidate. Include exact company name, disclosed USD valuation and month/year in valuation claim/summary; use status SUPPORTED only if the source explicitly states the narrow claim. A reputable independent outlet reporting a closed-round amount can SUPPORT the attributed statement that the outlet reported it, even if its source is unnamed; that is reported evidence, not company-confirmed terms. Record approximate figures and unknown basis honestly, and reduce candidate confidence rather than claiming certainty. Do not mark a clearly sourced report as fabricated merely because the company did not confirm it. Findings should identify stale valuations, ambiguous basis and missing data. Return corrections for existing evidence that is demonstrably wrong; never silently upgrade a claim. Confirm that the round CLOSED: in talks, seeking, nearing, closing in on, or proposed valuation is not an established financing mark. If a newer proposed round is unclosed, retain the last verified closed round with its historical date and explicitly flag the newer negotiations. Do not assert valuation is currently available to an investor. Keep source claim/summary under 25 words.`,
        {
          companies: reviewCompanies,
          priorPricedCompanies: startingCandidates.map((candidate) => candidate.company.name),
        },
      ),
      execute(
        bearId,
        `${replacement ? 'Reason independently from the supplied retrieved evidence only; no fresh search for this bounded replacement review. Clearly label newly introduced companies as having only a limited adversarial review. ' : ''}Challenge these companies for this thematic thesis ${replacement ? 'using admitted evidence' : 'using fresh research'}. Find the strongest disconfirming facts: public/acquired status, commercial weak points, competition, financing ambiguity, first-party-only traction, or a thesis that benefits everyone. Provide one practical kill criterion and next proof per candidate where evidence permits. Do not equate missing evidence with a negative fact. Return corrections only where a cited earlier claim is directly contradicted.`,
        {
          companies: reviewCompanies,
          earlierBearFindings: replacement
            ? board.agents
                .filter((agent) => agent.id.startsWith('bear') && agent.output)
                .map((agent) => agent.output!.findings)
            : [],
        },
        !replacement,
      ),
    ]);
    // Explicit, downward-only corrections remain visible on the original source records.
    for (const agent of board.agents.filter((a) => a.id === valuationId || a.id === bearId)) {
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
      rankingId,
      `Rank up to 5 of the supplied companies for further venture diligence. When a preferred valuation ceiling is configured, favour genuinely niche specialists with disclosed marks within it; aim for at least three within the preference IF source-backed candidates exist. Otherwise return fewer and explain the gap, or explicitly identify larger comparisons. Product and sector variety should reflect different causal exposures within the theme, never arbitrary quotas. Include nicheReason (the specific overlooked product/customer angle) and tailwind:{change,customerNeed,companyFit,weakestLink,status:VERIFIED|REASONED HYPOTHESIS|SPECULATIVE,evidenceIds}. Tailwind must explain a recent real-world change, the new customer need it creates, this company's exact fit and the weakest assumption. Cite evidence for every asserted factual change; whole-chain upside is usually REASONED HYPOTHESIS, even when the original change is verified. Do not treat a funding announcement alone as a market tailwind. Include only real, still-private companies with explicit, sourced USD financing valuation and month/year. Five is a maximum, not a quota. Never invent a valuation to fill a slot. Synthesis only; no new evidence or searches. Compare relative valuation against sourced commercial proof and risk, not absolute cheapness. Unknown traction cannot justify RELATIVE VALUE. Use LOW confidence when evidence is thin or old. Put exact structured results in optional shortlist (not in findings). Each shortlist item must match this schema: ${JSON.stringify({ companyId: 'exact existing company id', rank: 1, rationale: 'why this deserves attention now', valuation: { amountUsd: 1500000000, asOf: 'YYYY-MM or YYYY-MM-DD', label: 'historical disclosed financing valuation', round: 'round name if disclosed, otherwise Undisclosed round', basis: 'POST_MONEY | PRE_MONEY | UNDISCLOSED_BASIS', evidenceIds: ['existing ids explicitly stating amount and month/year'] }, priceSignal: 'RELATIVE VALUE | MIXED | EXPENSIVE', priceReason: 'supported peer comparison; unknowns explicit', bullCase: 'reasoned upside mechanism', bearCase: 'best adversarial objection', killCriterion: 'falsifiable event that breaks this thesis', nextProof: 'one thing to verify next', confidence: 'HIGH | MEDIUM | LOW | INSUFFICIENT', evidenceIds: ['existing ids'] })}. Keep every shortlist narrative field under 25 words so all five fit in the output budget. Summary should state the strongest research conclusion and limitations. Evidence:[]; use normal concise findings separately. Source-backed values only: server will reject unsupported prices/dates. A financing announcement can be primary evidence of a company claim without proving realised business performance.`,
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
    board.candidates = assembleCandidates(board, companies, assessments).map((candidate) => {
      const prior = startingCandidates.find((entry) => entry.companyId === candidate.companyId);
      return prior
        ? { ...candidate, researchId: prior.researchId, latestReview: prior.latestReview }
        : candidate;
    });
    const rankedIds = new Set(board.candidates.map((candidate) => candidate.companyId));
    board.unpricedCompanies = companies.filter(
      (company) =>
        !rankedIds.has(company.id) &&
        !board.evidence.some(
          (entry) =>
            entry.status === 'SUPPORTED' &&
            (entry.company?.toLowerCase() === company.name.toLowerCase() ||
              entry.claim.toLowerCase().includes(company.name.toLowerCase())) &&
            !isNonPriceInstrument(`${entry.claim} ${entry.summary}`) &&
            valuationAmounts(entry.claim).length > 0,
        ),
    );
    board.summary = output.summary;
    board.confidence = board.candidates.length ? output.confidence : 'INSUFFICIENT';
    const failed = board.agents.filter(
      (a) => a.status === 'failed' && (!fillGaps || recoveryIds.includes(a.id)),
    );
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

/** Resume a partial shortlist without repeating successful discovery or hiding its actual cost. */
export async function fillThemeBoardGaps(
  board: ThemeBoard,
  onUpdate: (board: ThemeBoard) => void | Promise<void>,
  signal?: AbortSignal,
  agentRunner: typeof runClaudeAgent = runClaudeAgent,
): Promise<void> {
  return runThemeBoard(board, onUpdate, signal, agentRunner, { fillGaps: true });
}

/** One bounded pass replaces unpriced discoveries while retaining valid prior work and cost. */
export async function replaceUnpricedCandidates(
  board: ThemeBoard,
  onUpdate: (board: ThemeBoard) => void | Promise<void>,
  signal?: AbortSignal,
  agentRunner: typeof runClaudeAgent = runClaudeAgent,
): Promise<void> {
  return runThemeBoard(board, onUpdate, signal, agentRunner, { replacement: true });
}

/** Recover company identity gaps using existing actual financing research, not another broad scan. */
export async function resolveThemeBoardIdentities(
  board: ThemeBoard,
  onUpdate: (board: ThemeBoard) => void | Promise<void>,
  signal?: AbortSignal,
  agentRunner: typeof runClaudeAgent = runClaudeAgent,
): Promise<void> {
  return runThemeBoard(board, onUpdate, signal, agentRunner, { resolveIdentities: true });
}

/** Resolve the remaining named identities in one two-search follow-up and bounded review. */
export async function resolveExtraThemeBoardIdentities(
  board: ThemeBoard,
  onUpdate: (board: ThemeBoard) => void | Promise<void>,
  signal?: AbortSignal,
  agentRunner: typeof runClaudeAgent = runClaudeAgent,
): Promise<void> {
  return runThemeBoard(board, onUpdate, signal, agentRunner, { identityExtra: true });
}
