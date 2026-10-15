import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import { BoardAssessmentSchema, type ThemeBoard, type BoardAgentId } from '../shared/boards';
import {
  AgentOutputSchema,
  CompanySchema,
  ConfidenceSchema,
  EvidenceSchema,
} from '../shared/types';
import { assembleCandidates } from './boards';

const timestamp = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), 'Invalid timestamp');
const usage = z.number().int().nonnegative();
const agentIds = [
  'scout-established',
  'scout-emerging',
  'identity',
  'identity-extra',
  'valuation',
  'bear',
  'ranking',
  'scout-gap',
  'valuation-gap',
  'bear-gap',
  'ranking-gap',
  'scout-replacement',
  'valuation-replacement',
  'bear-replacement',
  'ranking-replacement',
] as const;
const CandidateSchema = BoardAssessmentSchema.extend({
  company: CompanySchema,
  manualRank: z.number().int().min(1).max(5).optional(),
  researchId: z.string().optional(),
  latestReview: z
    .object({
      investigationId: z.string(),
      checkedAt: timestamp,
      confidence: ConfidenceSchema,
      decision: z.string().optional(),
      verification: z.string().optional(),
      summary: z.string(),
      evidenceIds: z.array(z.string()),
    })
    .optional(),
});
const RecordedBoardSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(3),
    thesis: z.string().min(10),
    status: z.enum(['completed', 'partial']),
    mode: z.enum(['live', 'recorded']),
    createdAt: timestamp,
    updatedAt: timestamp,
    candidates: z.array(CandidateSchema).length(5),
    evidence: z.array(EvidenceSchema).min(1),
    agents: z
      .array(
        z.object({
          id: z.enum(agentIds),
          name: z.string().min(1),
          status: z.enum(['queued', 'running', 'completed', 'failed']),
          startedAt: timestamp.optional(),
          completedAt: timestamp.optional(),
          model: z.string().optional(),
          searches: usage,
          inputTokens: usage,
          outputTokens: usage,
          output: AgentOutputSchema.optional(),
          error: z.string().optional(),
        }),
      )
      .min(5),
    events: z
      .array(
        z.object({
          id: z.string().min(1),
          timestamp,
          agentId: z.enum(agentIds).optional(),
          type: z.enum(['started', 'search', 'completed', 'failed', 'ranking']),
          message: z.string().min(1),
        }),
      )
      .min(1),
    summary: z.string().min(1),
    confidence: ConfidenceSchema,
    totalInputTokens: usage.refine((value) => value > 0),
    totalOutputTokens: usage.refine((value) => value > 0),
    rankingMethod: z.string().min(1),
  })
  .passthrough();

/** Validate retained execution records; this never simulates usage, searches, or agent events. */
export function validateRecordedBoard(value: unknown): ThemeBoard {
  const parsed = RecordedBoardSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      `A theme recording needs five priced candidates and a completed real execution structure: ${parsed.error.issues
        .map((issue) => issue.path.join('.'))
        .slice(0, 4)
        .join(', ')}`,
    );
  const board = structuredClone(parsed.data) as ThemeBoard;
  const evidenceIds = new Set(board.evidence.map((entry) => entry.id));
  if (evidenceIds.size !== board.evidence.length)
    throw new Error('Theme recording has duplicate evidence identities.');
  const references = (ids: string[]) => {
    for (const id of ids)
      if (!evidenceIds.has(id))
        throw new Error(`Theme recording has an unknown source reference: ${id}`);
  };
  if (new Set(board.agents.map((agent) => agent.id)).size !== board.agents.length)
    throw new Error('Theme recording has duplicate agent identities.');
  if (board.agents.some((agent) => agent.status === 'running'))
    throw new Error('Theme recording cannot retain a running agent.');
  for (const agent of board.agents) {
    if (agent.status !== 'completed') continue;
    if (
      !agent.output ||
      !agent.startedAt ||
      !agent.completedAt ||
      !agent.model?.startsWith('claude-') ||
      agent.inputTokens <= 0 ||
      agent.outputTokens <= 0
    )
      throw new Error(`Theme recording lacks actual output, model or usage for ${agent.id}.`);
    if (
      !board.events.some((event) => event.agentId === agent.id && event.type === 'started') ||
      !board.events.some((event) => event.agentId === agent.id && event.type === 'completed')
    )
      throw new Error(`Theme recording lacks the ${agent.id} execution trail.`);
    for (const finding of agent.output.findings) references(finding.evidenceIds);
    for (const evidence of agent.output.evidence)
      if (!evidenceIds.has(evidence.id))
        throw new Error(`Theme recording omits retained agent evidence ${evidence.id}.`);
    for (const company of agent.output.companies || []) references(company.evidenceIds);
    for (const link of agent.output.causalChain || []) references(link.evidenceIds);
    for (const correction of agent.output.corrections || []) references([correction.evidenceId]);
    for (const item of agent.output.shortlist || []) {
      references(item.evidenceIds);
      references(item.valuation.evidenceIds);
      references(item.tailwind?.evidenceIds || []);
    }
  }
  const completedRole = (prefix: string, needsSearch: boolean) => {
    const stage = board.agents
      .filter((agent) => agent.id === prefix || agent.id.startsWith(`${prefix}-`))
      .at(-1);
    if (!stage || stage.status !== 'completed')
      throw new Error(
        `Theme recording needs a completed ${prefix} stage, including a completed recovery where present.`,
      );
    const searchedStage = (agent: typeof stage) =>
      agent.searches > 0 &&
      board.events.some((event) => event.agentId === agent.id && event.type === 'search');
    const priorAdversarialSearch =
      prefix === 'bear' &&
      stage.id === 'bear-replacement' &&
      board.agents.some(
        (agent) =>
          agent.id.startsWith('bear') && agent.status === 'completed' && searchedStage(agent),
      );
    if (needsSearch && !searchedStage(stage) && !priorAdversarialSearch)
      throw new Error(`Theme recording needs actual ${prefix} searches.`);
    return stage;
  };
  const scouts = board.agents.filter(
    (agent) => agent.id.startsWith('scout') && agent.status === 'completed',
  );
  if (
    !scouts.length ||
    !scouts.some(
      (agent) =>
        agent.searches > 0 &&
        board.events.some((event) => event.agentId === agent.id && event.type === 'search'),
    )
  )
    throw new Error('Theme recording needs genuine completed company discovery.');
  completedRole('valuation', true);
  completedRole('bear', true);
  const committee = completedRole('ranking', false);
  if (!board.events.some((event) => event.type === 'ranking'))
    throw new Error('Theme recording needs its final ranking audit event.');
  if (
    board.agents.reduce((sum, agent) => sum + agent.inputTokens, 0) !== board.totalInputTokens ||
    board.agents.reduce((sum, agent) => sum + agent.outputTokens, 0) !== board.totalOutputTokens
  )
    throw new Error('Theme recording usage totals must match retained provider stages.');
  const domains = new Set(
    board.candidates.map((candidate) =>
      new URL(candidate.company.website).hostname.replace(/^www\./, ''),
    ),
  );
  if (
    domains.size !== 5 ||
    new Set(board.candidates.map((candidate) => candidate.companyId)).size !== 5
  )
    throw new Error('Theme recording needs five distinct companies.');
  const admitted = assembleCandidates(
    board,
    board.candidates.map((candidate) => candidate.company),
    board.candidates,
  );
  if (admitted.length !== 5)
    throw new Error('Theme recording contains an unsupported historical valuation amount or date.');
  for (const candidate of board.candidates) {
    if (candidate.companyId !== candidate.company.id)
      throw new Error('Theme recording company identity does not match its assessment.');
    references(candidate.tailwind?.evidenceIds || []);
    references(candidate.evidenceIds);
    references(candidate.company.evidenceIds);
    references(candidate.valuation.evidenceIds);
    references(candidate.latestReview?.evidenceIds || []);
    const original = committee.output!.shortlist?.find(
      (item) => item.companyId === candidate.companyId,
    );
    if (
      !original ||
      original.valuation.amountUsd !== candidate.valuation.amountUsd ||
      original.valuation.asOf !== candidate.valuation.asOf
    )
      throw new Error('Theme recording price must match the actual final committee output.');
  }
  const ranks = board.candidates.map((candidate) => candidate.rank).sort();
  if (ranks.join(',') !== '1,2,3,4,5')
    throw new Error('Theme recording needs a complete ordinal ranking.');
  board.mode = 'recorded';
  return board;
}

export function loadBoardRecordings(directory = resolve('recordings/themes')): ThemeBoard[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => validateRecordedBoard(JSON.parse(readFileSync(join(directory, name), 'utf8'))));
}
