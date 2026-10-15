import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ThemeBoard } from '../shared/boards';
import type { Evidence } from '../shared/types';
import { deriveUniverseNodes } from '../src/lib/universe';

const source = (
  id: string,
  type: Evidence['type'],
  status: Evidence['status'] = 'SUPPORTED',
): Evidence => ({
  id,
  type,
  status,
  claim: 'Cited claim',
  url: `https://example.com/${id}`,
  title: 'Source',
  publisher: 'Publisher',
  publishedAt: null,
  retrievedAt: '2026-10-15T12:00:00Z',
  summary: 'Evidence',
});
function board(): ThemeBoard {
  return {
    id: 'theme',
    title: 'AI infrastructure',
    thesis: 'Infrastructure demand from agents',
    status: 'completed',
    mode: 'live',
    createdAt: '2026-10-15T12:00:00Z',
    updatedAt: '2026-10-15T12:00:00Z',
    candidates: [
      {
        companyId: 'company',
        company: {
          id: 'company',
          name: 'Company',
          website: 'https://company.com',
          description: 'Infrastructure',
          category: 'AI',
          alignment: 'Thesis',
          strengths: [],
          uncertainty: 'Unproven retention',
          confidence: 'MEDIUM',
          evidenceIds: ['independent', 'company'],
        },
        rank: 1,
        manualRank: 2,
        rationale: 'Research priority',
        confidence: 'MEDIUM',
        valuation: {
          amountUsd: 1e9,
          asOf: '2026-10',
          label: 'Disclosed round',
          round: 'Series B',
          basis: 'POST_MONEY',
          evidenceIds: ['company'],
        },
        priceSignal: 'MIXED',
        priceReason: 'Compare peers',
        bullCase: 'Adoption',
        bearCase: 'Competition',
        killCriterion: 'Weak retention',
        nextProof: 'Revenue cohort evidence',
        evidenceIds: ['independent', 'company'],
      },
    ],
    evidence: [
      source('independent', 'INDEPENDENT_REPORT'),
      source('company', 'FIRST_PARTY_COMPANY_CLAIM'),
    ],
    agents: [],
    events: [],
    summary: 'Research',
    confidence: 'MEDIUM',
    totalInputTokens: 10,
    totalOutputTokens: 10,
    rankingMethod: 'Research priority',
  };
}

test('removing company claims moves only unsupported-by-independent-evidence companies outward', () => {
  const input = board();
  const before = JSON.stringify(input);
  const all = deriveUniverseNodes([input])[0];
  const independent = deriveUniverseNodes([input], 'all', true)[0];
  assert.equal(all.remaining, 2);
  assert.equal(independent.remaining, 1);
  assert.ok(independent.radius > all.radius);
  assert.equal(
    independent.point.y,
    all.point.y,
    'the lens cannot invent a new agent confidence assessment',
  );
  input.evidence[1].type = 'RESEARCH_PUBLICATION';
  assert.equal(deriveUniverseNodes([input], 'all', true)[0].radius, all.radius);
  input.evidence[1].type = 'FIRST_PARTY_COMPANY_CLAIM';
  assert.equal(JSON.stringify(input), before, 'the lens must not mutate source records or ranks');
});

test('a completed Red Team review changes height and admitted source basis while preserving shortlist rank', () => {
  const input = board();
  const original = deriveUniverseNodes([input])[0];
  input.candidates[0].latestReview = {
    investigationId: 'review',
    checkedAt: '2026-10-15T13:00:00Z',
    confidence: 'LOW',
    decision: 'MONITOR',
    verification: 'CONTRADICTED',
    summary: 'Customer claim was withdrawn',
    evidenceIds: ['new', 'company'],
  };
  input.evidence[1].status = 'CONTRADICTED';
  input.evidence.push(source('new', 'INDEPENDENT_REPORT'));
  const revised = deriveUniverseNodes([input])[0];
  assert.equal(revised.confidence, 'LOW');
  assert.ok(
    revised.point.y > original.point.y,
    'lower confidence has a lower position in the SVG coordinate system',
  );
  assert.ok(
    revised.radius > original.radius,
    'a contradicted citation reduces the supported evidence share',
  );
  assert.equal(revised.evidenceCount, 3, 'review and valuation citations are admitted once');
  assert.equal(revised.remaining, 2);
  assert.equal(revised.candidate.rank, 1);
  assert.equal(revised.candidate.manualRank, 2);
});

test('missing citations, repeated records and draft themes cannot manufacture orbit support', () => {
  const input = board();
  input.candidates[0].evidenceIds.push('missing');
  input.evidence.push(source('company', 'FIRST_PARTY_COMPANY_CLAIM', 'CONTRADICTED'));
  const node = deriveUniverseNodes([input])[0];
  assert.equal(node.evidenceCount, 3);
  assert.equal(node.remaining, 1, 'the latest source record for an evidence ID wins');
  assert.equal(node.supportShare, 1 / 3);
  assert.equal(deriveUniverseNodes([input], 'unrelated').length, 0);
  input.status = 'draft';
  input.candidates = [];
  assert.equal(deriveUniverseNodes([input]).length, 0);
});
