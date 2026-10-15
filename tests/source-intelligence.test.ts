import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Evidence, Investigation } from '../shared/types';
import {
  publicSourceDomain,
  sourceName,
  summarizeSourceHistory,
  SOURCE_HISTORY_EXPLANATION,
} from '../src/lib/source-intelligence';

function evidence(id: string, patch: Partial<Evidence> = {}): Evidence {
  return {
    id,
    claim: `Claim ${id}`,
    url: 'https://www.publisher.com/report',
    publisher: 'Publisher',
    title: 'Report',
    publishedAt: null,
    retrievedAt: '2026-10-15T10:00:00Z',
    summary: 'Research',
    type: 'INDEPENDENT_REPORT',
    status: 'SUPPORTED',
    ...patch,
  };
}
function run(id: string, records: Evidence[], patch: Partial<Investigation> = {}): Investigation {
  return {
    id,
    title: 'Research',
    query: 'Question',
    mode: 'live',
    status: 'completed',
    createdAt: '2026-10-15T10:00:00Z',
    agents: [],
    events: [],
    evidence: records,
    confidence: 'LOW',
    watched: false,
    totalInputTokens: 100,
    totalOutputTokens: 100,
    ...patch,
  };
}

test('source audit deduplicates documents while preserving separate claims and independent runs', () => {
  const result = summarizeSourceHistory([
    run('one', [
      evidence('a'),
      evidence('b', {
        url: 'https://www.publisher.com/report?utm_source=scout#results',
        status: 'PARTIAL',
      }),
    ]),
    run('two', [evidence('a', { status: 'UNVERIFIED' })]),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].domain, 'publisher.com');
  assert.equal(result[0].sourceCount, 1);
  assert.equal(result[0].investigationCount, 2);
  assert.equal(result[0].auditedClaims, 3);
  assert.equal(result[0].supported, 1);
  assert.equal(result[0].partial, 1);
  assert.equal(result[0].unverified, 1);
  assert.equal(result[0].status, 'Limited history');
  assert.equal(result[0].predictivePerformance, 'Not measured');
  assert.match(result[0].summary, /recorded claim assessments/);
  assert.match(SOURCE_HISTORY_EXPLANATION, /agent-assigned/);
  assert.match(SOURCE_HISTORY_EXPLANATION, /not independent audits/);
});

test('sample findings cannot manufacture a track record and current citations are not historical validation', () => {
  const result = summarizeSourceHistory(
    [run('sample', [evidence('a')], { mode: 'sample' })],
    [evidence('current')],
  );
  assert.equal(result[0].sourceCount, 1);
  assert.equal(result[0].investigationCount, 0);
  assert.equal(result[0].auditedClaims, 0);
  assert.equal(result[0].status, 'No research history');
  assert.equal(
    summarizeSourceHistory([run('sample', [evidence('a')], { mode: 'sample' })]).length,
    0,
  );
});

test('duplicate replay and live snapshots preserve the newest correction without doubling history', () => {
  const original = evidence('a');
  const revised = evidence('a', {
    status: 'CONTRADICTED',
    correction: 'Agent attributed a competitor customer to this company.',
    reviewedAt: '2026-10-15T12:00:00Z',
  });
  const result = summarizeSourceHistory([
    run('same-run', [revised]),
    run('same-run', [original], { mode: 'recorded' }),
  ])[0];
  assert.equal(result.investigationCount, 1);
  assert.equal(result.auditedClaims, 1);
  assert.equal(result.corrected, 1);
  assert.equal(result.contradicted, 1);
  assert.equal(result.supported, 0);
  assert.equal(result.status, 'Corrections recorded');
  assert.match(result.summary, /our interpretation/);
});

test('source history counts retain meaningful document queries and do not mutate records', () => {
  const first = evidence('one', { url: 'https://publisher.com/report?id=1' });
  const second = evidence('two', { url: 'https://publisher.com/report?id=2' });
  const input = [run('one', [first, second])];
  const before = JSON.stringify(input);
  assert.equal(summarizeSourceHistory(input)[0].sourceCount, 2);
  assert.equal(JSON.stringify(input), before);
});

test('favicon domains do not leak private addresses, credentials, full paths or query strings', () => {
  assert.equal(publicSourceDomain('https://www.ft.com/content/story?private=token#part'), 'ft.com');
  for (const url of [
    'http://localhost:3001',
    'http://127.0.0.1/a',
    'http://192.168.1.2',
    'http://[::1]',
    'https://private.internal',
    'https://host.local',
    'https://u:password@publisher.com',
    'data:text/html,test',
    'malformed',
  ]) {
    assert.equal(publicSourceDomain(url), null, url);
  }
});

test('publisher labels resolve exact canonical hosts without promoting lookalikes or unsafe URLs', () => {
  assert.equal(sourceName('https://www.ft.com/content/report', 'FT story'), 'Financial Times');
  assert.equal(
    sourceName('https://research.contrary.com/company/browserbase'),
    'Contrary Research',
  );
  assert.equal(sourceName('https://github.com/company/repository'), 'GitHub');
  assert.equal(sourceName('https://wsj.com.evil.example/report'), 'wsj.com.evil.example');
  assert.equal(sourceName('https://notft.com/report', 'Provided publisher'), 'Provided publisher');
  assert.equal(
    sourceName('https://news.ft.com/report', 'Unlisted subdomain'),
    'Unlisted subdomain',
  );
  assert.equal(sourceName('https://ft.com@evil.example/report'), 'Source');
  assert.equal(sourceName('https://user:password@ft.com/report'), 'Source');
  assert.equal(sourceName('javascript:alert(1)', 'Unknown source'), 'Unknown source');
  const history = summarizeSourceHistory([
    run('one', [
      evidence('ft', { url: 'https://www.ft.com/report', publisher: 'Odd provider label' }),
    ]),
  ]);
  assert.equal(history[0].publisher, 'Financial Times');
});
