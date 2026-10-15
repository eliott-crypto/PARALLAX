import { z } from 'zod';
import type { AgentOutput, Company, Confidence, Evidence } from './types.js';

/** A disclosed financing valuation is historical evidence, never a live offer. */
export const BoardAssessmentSchema = z.object({
  companyId: z.string(),
  rank: z.number().int().min(1).max(5),
  rationale: z.string().max(700),
  valuation: z.object({
    amountUsd: z.number().positive(),
    asOf: z.string().regex(/^\d{4}-\d{2}(?:-\d{2})?$/),
    label: z.string().max(300),
    round: z.string().max(160),
    basis: z.enum(['POST_MONEY', 'PRE_MONEY', 'UNDISCLOSED_BASIS']),
    evidenceIds: z.array(z.string()).min(1),
  }),
  priceSignal: z.enum(['RELATIVE VALUE', 'MIXED', 'EXPENSIVE']),
  priceReason: z.string().max(500),
  bullCase: z.string().max(600),
  bearCase: z.string().max(600),
  killCriterion: z.string().max(400),
  nextProof: z.string().max(400),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT']),
  evidenceIds: z.array(z.string()).min(1),
});
export type BoardAssessment = z.infer<typeof BoardAssessmentSchema>;
export interface BoardCandidate extends BoardAssessment {
  company: Company;
  manualRank?: number;
  researchId?: string;
  latestReview?: {
    investigationId: string;
    checkedAt: string;
    confidence: Confidence;
    decision?: string;
    verification?: string;
    summary: string;
    evidenceIds: string[];
  };
}
export type BoardAgentId =
  'scout-established' | 'scout-emerging' | 'valuation' | 'bear' | 'ranking';
export interface BoardAgent {
  id: BoardAgentId;
  name: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  model?: string;
  searches: number;
  inputTokens: number;
  outputTokens: number;
  output?: AgentOutput;
  error?: string;
}
export interface BoardEvent {
  id: string;
  timestamp: string;
  agentId?: BoardAgentId;
  type: 'started' | 'search' | 'completed' | 'failed' | 'ranking';
  message: string;
}
export interface ThemeBoard {
  id: string;
  title: string;
  thesis: string;
  status: 'draft' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
  mode: 'live' | 'recorded';
  createdAt: string;
  updatedAt: string;
  candidates: BoardCandidate[];
  evidence: Evidence[];
  agents: BoardAgent[];
  events: BoardEvent[];
  summary: string;
  confidence: Confidence;
  error?: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  rankingMethod: string;
  previousRanking?: {
    capturedAt: string;
    candidates: BoardCandidate[];
    evidence: Evidence[];
    summary: string;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
}
export const BoardRequestSchema = z.object({
  title: z.string().trim().min(3).max(100),
  thesis: z.string().trim().min(10).max(700),
});
