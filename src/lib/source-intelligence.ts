import type { Evidence, Investigation } from '../../shared/types';
import { canonicalSourceUrl } from './api';

/** Only public HTTP(S) hostnames may be sent to the icon provider. */
export function publicSourceDomain(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    if (
      !host.includes('.') ||
      host.endsWith('.local') ||
      host.endsWith('.localhost') ||
      host.endsWith('.internal')
    )
      return null;
    if (/^[\d.]+$/.test(host) || host.includes(':') || !/^[a-z0-9.-]+$/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

const SOURCE_NAMES: Readonly<Record<string, string>> = {
  'ft.com': 'Financial Times',
  'insurancejournal.com': 'Insurance Journal',
  'satnews.com': 'SatNews',
  'datacenterdynamics.com': 'Data Center Dynamics',
  'starcloud.com': 'Starcloud',
  'tradingview.com': 'TradingView',
  'geekwire.com': 'GeekWire',
  'spaceflightnow.com': 'Spaceflight Now',
  'wsj.com': 'The Wall Street Journal',
  'thenewstack.io': 'The New Stack',
  'chainguard.dev': 'Chainguard',
  'runtimewire.com': 'RuntimeWire',
  'browserbase.com': 'Browserbase',
  'steel.dev': 'Steel',
  'sacra.com': 'Sacra',
  'research.contrary.com': 'Contrary Research',
  'outsetcapital.com': 'Outset Capital',
  'github.com': 'GitHub',
  'qconsf.com': 'QCon',
  'npmjs.com': 'npm',
  'stripe.com': 'Stripe',
  'techcrunch.com': 'TechCrunch',
  'reuters.com': 'Reuters',
  'bloomberg.com': 'Bloomberg',
  'e2b.dev': 'E2B',
  'taskade.com': 'Taskade',
  'crunchbase.com': 'Crunchbase',
};

/** Exact known hosts only: lookalikes and unlisted subdomains keep their label. */
export function sourceName(url: string, fallback?: string): string {
  const domain = publicSourceDomain(url);
  return (domain && SOURCE_NAMES[domain]) || fallback?.trim() || domain || 'Source';
}

export interface SourceTrackRecord {
  domain: string;
  publisher: string;
  url: string;
  sourceCount: number;
  investigationCount: number;
  auditedClaims: number;
  supported: number;
  partial: number;
  unverified: number;
  contradicted: number;
  corrected: number;
  status:
    | 'No research history'
    | 'Limited history'
    | 'Corrections recorded'
    | 'Research history available';
  summary: string;
  predictivePerformance: 'Not measured';
}

interface DomainAudit {
  publisher: string;
  url: string;
  documents: Set<string>;
  runs: Set<string>;
  claims: Map<string, Evidence>;
}

/**
 * Local record of agent claim assessments, never a publisher reliability score
 * or investment hit rate. SUPPORTED is an agent's assessment, not an independent
 * audit of the publisher or a measured investment outcome.
 * A correction can reflect our model misreading a sound source. Sample research
 * and copied replay/live versions of the same run must not inflate its history.
 * Current radar evidence adds documents, but does not become historical validation.
 */
export function summarizeSourceHistory(
  investigations: readonly Investigation[],
  currentEvidence: readonly Evidence[] = [],
): SourceTrackRecord[] {
  const domains = new Map<string, DomainAudit>();
  const getDomain = (evidence: Evidence) => {
    const domain = publicSourceDomain(evidence.url);
    if (!domain) return null;
    let audit = domains.get(domain);
    if (!audit) {
      audit = {
        publisher: sourceName(evidence.url, evidence.publisher),
        url: `https://${domain}`,
        documents: new Set(),
        runs: new Set(),
        claims: new Map(),
      };
      domains.set(domain, audit);
    }
    audit.documents.add(canonicalSourceUrl(evidence.url));
    return audit;
  };

  // Merge duplicate snapshots by evidence identity; revised evidence wins even
  // when a replay snapshot was received after the current live investigation.
  const runs = new Map<string, Map<string, Evidence>>();
  for (const run of investigations) {
    if (run.mode === 'sample') continue;
    const records = runs.get(run.id) ?? new Map<string, Evidence>();
    runs.set(run.id, records);
    for (const evidence of run.evidence) {
      const old = records.get(evidence.id);
      const revisedAt = Date.parse(evidence.reviewedAt || evidence.retrievedAt) || 0;
      const oldAt = old ? Date.parse(old.reviewedAt || old.retrievedAt) || 0 : -1;
      if (
        !old ||
        revisedAt > oldAt ||
        (revisedAt === oldAt && evidence.correction && !old.correction)
      )
        records.set(evidence.id, evidence);
    }
  }
  for (const [runId, records] of runs) {
    for (const evidence of records.values()) {
      const audit = getDomain(evidence);
      if (!audit) continue;
      audit.runs.add(runId);
      audit.claims.set(`${runId}:${evidence.id}`, evidence);
    }
  }
  for (const evidence of currentEvidence) getDomain(evidence);

  return [...domains.entries()]
    .map(([domain, audit]): SourceTrackRecord => {
      const claims = [...audit.claims.values()];
      const count = (status: Evidence['status']) =>
        claims.filter((claim) => claim.status === status).length;
      const corrected = claims.filter((claim) => Boolean(claim.correction?.trim())).length;
      const status = !claims.length
        ? 'No research history'
        : corrected
          ? 'Corrections recorded'
          : audit.runs.size < 3
            ? 'Limited history'
            : 'Research history available';
      return {
        domain,
        publisher: audit.publisher,
        url: audit.url,
        sourceCount: audit.documents.size,
        investigationCount: audit.runs.size,
        auditedClaims: claims.length,
        supported: count('SUPPORTED'),
        partial: count('PARTIAL'),
        unverified: count('UNVERIFIED'),
        contradicted: count('CONTRADICTED'),
        corrected,
        status,
        summary: !claims.length
          ? 'Cited in the current research. No recorded claim assessments yet.'
          : `${claims.length} recorded claim assessment${claims.length === 1 ? '' : 's'} across ${audit.runs.size} investigation${audit.runs.size === 1 ? '' : 's'}. ${corrected} correction${corrected === 1 ? '' : 's'} to our interpretation.`,
        predictivePerformance: 'Not measured',
      };
    })
    .sort(
      (a, b) =>
        b.investigationCount - a.investigationCount ||
        b.sourceCount - a.sourceCount ||
        a.domain.localeCompare(b.domain),
    );
}

export const SOURCE_HISTORY_EXPLANATION =
  'These are agent-assigned claim statuses recorded by PARALLAX, not independent audits or publisher accuracy ratings. Corrections identify reviewed interpretations and may reflect an agent misreading a sound source. Investment signal accuracy is not measured: no realised outcome history is available.';
