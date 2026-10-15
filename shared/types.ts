import { z } from 'zod';
export const ConfidenceSchema = z.enum(['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT']);
export type Confidence = z.infer<typeof ConfidenceSchema>;
export const EvidenceSchema = z.object({
  id: z.string(),
  claim: z.string(),
  url: z
    .string()
    .url()
    .refine((v) => /^https?:/.test(v)),
  title: z.string(),
  publisher: z.string(),
  publishedAt: z.string().nullable().default(null),
  retrievedAt: z.string(),
  summary: z.string(),
  type: z.enum([
    'OFFICIAL_DOCUMENT',
    'FIRST_PARTY_COMPANY_CLAIM',
    'INDEPENDENT_REPORT',
    'PUBLIC_PROFESSIONAL_RECORD',
    'RESEARCH_PUBLICATION',
    'ANALYST_INFERENCE',
  ]),
  status: z.enum(['SUPPORTED', 'PARTIAL', 'UNVERIFIED', 'CONTRADICTED']),
  company: z.string().optional(),
  correction: z.string().optional(),
  reviewedAt: z.string().optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;
export const CausalLinkSchema = z.object({
  label: z.string(),
  status: z.enum(['VERIFIED', 'REASONED HYPOTHESIS', 'SPECULATIVE']),
  evidenceIds: z.array(z.string()).default([]),
});
export type CausalLink = z.infer<typeof CausalLinkSchema>;
export const CompanySchema = z.object({
  id: z.string(),
  name: z.string(),
  website: z
    .string()
    .url()
    .refine((v) => /^https?:/.test(v)),
  description: z.string(),
  category: z.string(),
  alignment: z.string(),
  strengths: z.array(z.string()),
  uncertainty: z.string(),
  confidence: ConfidenceSchema,
  evidenceIds: z.array(z.string()),
  headquarters: z.string().optional(),
  funding: z.string().optional(),
});
export type Company = z.infer<typeof CompanySchema>;
export const SignalSchema = z.object({
  id: z.string(),
  title: z.string(),
  sector: z.string(),
  summary: z.string(),
  whyNow: z.string(),
  date: z.string(),
  confidence: ConfidenceSchema,
  evidenceIds: z.array(z.string()),
  sourceCount: z.number().int().nonnegative(),
  causalChain: z.array(CausalLinkSchema),
  companies: z.array(CompanySchema).max(3),
  uncertainty: z.string(),
});
export type Signal = z.infer<typeof SignalSchema>;
export const AgentIds = [
  'scout',
  'causal',
  'hunter',
  'founder',
  'competitive',
  'bull',
  'bear',
  'verifier',
  'committee',
] as const;
export type AgentId = (typeof AgentIds)[number];
export const AGENTS: { id: AgentId; name: string; role: string; color: string }[] = [
  { id: 'scout', name: 'The Scout', role: 'Signal detection', color: '#9dbcf8' },
  { id: 'causal', name: 'Causal Analyst', role: 'Second-order effects', color: '#bca6f9' },
  { id: 'hunter', name: 'Company Hunter', role: 'Company discovery', color: '#91d1c7' },
  { id: 'founder', name: 'Founder Analyst', role: 'Professional verification', color: '#cbb78e' },
  { id: 'competitive', name: 'Competitive Analyst', role: 'Market positioning', color: '#9dbcf8' },
  { id: 'bull', name: 'The Bull', role: 'Investment case', color: '#85ceb0' },
  { id: 'bear', name: 'The Bear', role: 'Adversarial challenge', color: '#e49d9f' },
  { id: 'verifier', name: 'The Verifier', role: 'Independent fact check', color: '#bca6f9' },
  { id: 'committee', name: 'Investment Committee', role: 'Final assessment', color: '#d8dce7' },
];
export const FindingSchema = z.object({
  title: z.string(),
  detail: z.string(),
  evidenceIds: z.array(z.string()).default([]),
  kind: z.enum(['FACT', 'COMPANY CLAIM', 'HYPOTHESIS', 'UNKNOWN']).default('HYPOTHESIS'),
});
export type Finding = z.infer<typeof FindingSchema>;
export const EvidenceCorrectionSchema = z.object({
  evidenceId: z.string(),
  status: z.enum(['CONTRADICTED', 'UNVERIFIED', 'PARTIAL']),
  reason: z.string(),
});
export const AgentOutputSchema = z.object({
  summary: z.string(),
  findings: z.array(FindingSchema),
  evidence: z.array(EvidenceSchema).default([]),
  companies: z.array(CompanySchema).max(3).optional(),
  causalChain: z.array(CausalLinkSchema).optional(),
  questions: z.array(z.string()).default([]),
  corrections: z.array(EvidenceCorrectionSchema).optional(),
  disputedClaim: z.string().optional(),
  verification: z
    .enum(['SUPPORTED', 'CONTRADICTED', 'PARTIALLY SUPPORTED', 'UNRESOLVED'])
    .optional(),
  revision: z.string().optional(),
  decision: z.enum(['PRIORITISE RESEARCH', 'MONITOR', 'PASS', 'INSUFFICIENT EVIDENCE']).optional(),
  confidence: ConfidenceSchema.default('LOW'),
});
export type AgentOutput = z.infer<typeof AgentOutputSchema>;
export interface AgentRun {
  model?: string;
  id: AgentId;
  status: 'queued' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  output?: AgentOutput;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  searches?: number;
}
export interface AgentEvent {
  id: string;
  investigationId: string;
  timestamp: string;
  agentId?: AgentId;
  type: string;
  message: string;
  evidenceIds?: string[];
  payload?: unknown;
}
export interface Investigation {
  id: string;
  title: string;
  query: string;
  signalId?: string;
  company?: Company;
  mode: 'live' | 'sample' | 'recorded';
  status: 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
  createdAt: string;
  completedAt?: string;
  agents: AgentRun[];
  events: AgentEvent[];
  evidence: Evidence[];
  decision?: AgentOutput['decision'];
  confidence: Confidence;
  error?: string;
  watched: boolean;
  reviewNotes?: string[];
  model?: string;
  totalInputTokens: number;
  totalOutputTokens: number;
}
export interface RadarData {
  signals: Signal[];
  evidence: Evidence[];
  mode: 'live' | 'sample';
  updatedAt: string;
  warning?: string;
}
export interface ApiStatus {
  committeeModel?: string;
  configured: boolean;
  model: string;
  activeRuns: number;
  version: string;
  webSearch: string;
}
export const InvestigationRequestSchema = z.object({
  query: z.string().trim().min(3).max(600),
  signalId: z.string().max(100).optional(),
  company: CompanySchema.optional(),
});
export const ScanRequestSchema = z.object({
  sector: z.string().trim().min(2).max(80).default('All sectors'),
  query: z.string().trim().max(500).optional(),
});
export interface MarketThesis {
  summary: string;
  causalChain: CausalLink[];
  confidence: Confidence;
}
export interface FounderProfessionalRecord {
  name: string;
  role: string;
  timeline: Finding[];
  questions: string[];
}
export interface Source {
  url: string;
  title: string;
  publisher: string;
  publishedAt: string | null;
  retrievedAt: string;
}
export interface Challenge {
  claim: string;
  objection: string;
  evidenceIds: string[];
}
export interface VerificationOutcome {
  claim: string;
  status: 'SUPPORTED' | 'CONTRADICTED' | 'PARTIALLY SUPPORTED' | 'UNRESOLVED';
  resolution: string;
  evidenceIds: string[];
}
export interface InvestmentAssessment {
  decision: NonNullable<AgentOutput['decision']>;
  confidence: Confidence;
  thesis: string;
  strengths: Finding[];
  uncertainties: string[];
  nextActions: string[];
}
