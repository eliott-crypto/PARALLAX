import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleCandidates, createThemeBoard, runThemeBoard } from '../server/boards.js';
import type { BoardAssessment } from '../shared/boards.js';
import type { AgentOutput, Company, Evidence } from '../shared/types.js';
import type { AgentCall, AgentResult } from '../server/claude.js';

function company(index: number): Company {
  return {
    id: `company-${index}`,
    name: `TestCo ${index}`,
    website: `https://testco${index}.example`,
    description: 'Private infrastructure company fixture',
    category: 'Infrastructure',
    alignment: 'Infrastructure bottleneck',
    strengths: [],
    uncertainty: 'Commercial performance unknown',
    confidence: 'LOW',
    evidenceIds: [`valuation-${index}`],
  };
}
function evidence(index: number): Evidence {
  return {
    id: `valuation-${index}`,
    claim: `TestCo ${index} announced a $${index + 1} billion valuation in May 2025.`,
    url: `https://testco${index}.example/financing`,
    title: 'Financing announcement',
    publisher: `testco${index}.example`,
    publishedAt: '2025-05-20',
    retrievedAt: '2026-10-15T00:00:00Z',
    summary: 'Historical financing valuation, not a live quote.',
    type: 'FIRST_PARTY_COMPANY_CLAIM',
    status: 'SUPPORTED',
    company: `TestCo ${index}`,
  };
}
function assessment(index: number): BoardAssessment {
  return {
    companyId: `company-${index}`,
    rank: index + 1,
    rationale: 'Sourced research priority',
    valuation: {
      amountUsd: (index + 1) * 1e9,
      asOf: '2025-05',
      label: 'Historical financing valuation',
      round: 'Series B',
      basis: 'POST_MONEY',
      evidenceIds: [`valuation-${index}`],
    },
    priceSignal: 'MIXED',
    priceReason: 'Revenue unavailable; relative value uncertain',
    bullCase: 'Thesis may drive demand',
    bearCase: 'Competition may capture the value',
    killCriterion: 'Customers stop adopting paid infrastructure',
    nextProof: 'Verify retention',
    confidence: 'LOW',
    evidenceIds: [`valuation-${index}`],
  };
}
function output(extra: Partial<AgentOutput> = {}): AgentOutput {
  return {
    summary: 'Research fixture',
    findings: [],
    evidence: [],
    questions: [],
    confidence: 'LOW',
    ...extra,
  };
}
function result(value: AgentOutput): AgentResult {
  return {
    model: 'test-model',
    output: value,
    inputTokens: 100,
    outputTokens: 20,
    searches: 1,
    sources: [],
    retrievedSources: [],
    rejectedEvidence: 0,
  };
}

test('pricing gate requires an admitted valuation amount, date and correct company attribution', () => {
  const board = { evidence: [evidence(0), evidence(1)] };
  assert.equal(assembleCandidates(board, [company(0)], [assessment(0)]).length, 1);
  assert.equal(
    assembleCandidates(
      board,
      [{ ...company(0), description: 'Publicly traded on NASDAQ' }],
      [assessment(0)],
    ).length,
    0,
  );
  assert.equal(
    assembleCandidates(
      board,
      [{ ...company(0), description: 'Former startup acquired by a large vendor' }],
      [assessment(0)],
    ).length,
    0,
  );
  assert.equal(
    assembleCandidates(
      board,
      [company(0)],
      [{ ...assessment(0), valuation: { ...assessment(0).valuation, amountUsd: 2e9 } }],
    ).length,
    0,
  );
  assert.equal(
    assembleCandidates(
      board,
      [company(0)],
      [{ ...assessment(0), valuation: { ...assessment(0).valuation, asOf: '2099-05' } }],
    ).length,
    0,
  );
  assert.equal(
    assembleCandidates(
      board,
      [company(0)],
      [{ ...assessment(0), valuation: { ...assessment(0).valuation, asOf: '2025-06' } }],
    ).length,
    0,
  );
  assert.equal(
    assembleCandidates(
      board,
      [company(0)],
      [
        {
          ...assessment(0),
          valuation: { ...assessment(0).valuation, evidenceIds: ['valuation-1'] },
        },
      ],
    ).length,
    0,
  );
  assert.equal(
    assembleCandidates(
      { evidence: [{ ...evidence(0), status: 'CONTRADICTED' }] },
      [company(0)],
      [assessment(0)],
    ).length,
    0,
  );
  assert.equal(
    assembleCandidates(
      { evidence: [{ ...evidence(0), claim: 'TestCo 0 raised $1 billion in May 2025.' }] },
      [company(0)],
      [assessment(0)],
    ).length,
    0,
    'funding raised is not a valuation',
  );
  assert.equal(
    assembleCandidates(
      {
        evidence: [
          {
            ...evidence(0),
            claim: 'TestCo 0 raised $1 billion at a $10 billion valuation in May 2025.',
          },
        ],
      },
      [company(0)],
      [assessment(0)],
    ).length,
    0,
    'funding and valuation amounts in one sentence stay distinct',
  );
});

test('proposed financing negotiations are not an established historical valuation', () => {
  const speculative = {
    ...evidence(0),
    claim: 'TestCo 0 is in talks to raise at a $1 billion valuation in May 2025.',
  };
  assert.equal(
    assembleCandidates({ evidence: [speculative] }, [company(0)], [assessment(0)]).length,
    0,
  );
});

test('ranking deduplicates, renumbers, and never fabricates missing fifth company', () => {
  const board = { evidence: [evidence(0), evidence(1)] };
  const rows = assembleCandidates(
    board,
    [company(0), company(1)],
    [{ ...assessment(1), rank: 1 }, { ...assessment(0), rank: 4 }, assessment(0)],
  );
  assert.deepEqual(
    rows.map((value) => [value.company.id, value.rank]),
    [
      ['company-1', 1],
      ['company-0', 2],
    ],
  );
  assert.equal(rows.length, 2);
});

test('theme team scouts in parallel then independently verifies price and objections before committee', async () => {
  const board = createThemeBoard(
    'Infrastructure',
    'Infrastructure bottlenecks matter more as inference gets cheaper.',
  );
  assert.equal(board.status, 'draft');
  let scoutStarted = 0;
  let resolveScouts!: () => void;
  const bothScouts = new Promise<void>((resolve) => {
    resolveScouts = resolve;
  });
  const calls: AgentCall[] = [];
  const updates: string[] = [];
  await runThemeBoard(
    board,
    (state) => {
      updates.push(state.status);
    },
    undefined,
    async (call) => {
      calls.push(call);
      if (call.namespace.includes('scout-')) {
        scoutStarted++;
        if (scoutStarted === 2) resolveScouts();
        await bothScouts;
        const indexes = call.namespace.endsWith('established') ? [0, 1, 2] : [3, 4];
        return result(output({ companies: indexes.map(company), evidence: indexes.map(evidence) }));
      }
      if (call.namespace.endsWith('valuation') || call.namespace.endsWith('bear')) {
        assert.equal(scoutStarted, 2);
        assert.equal(call.previousEvidence.length, 5);
        return result(output());
      }
      assert.equal(
        board.agents.filter(
          (agent) => ['valuation', 'bear'].includes(agent.id) && agent.status === 'completed',
        ).length,
        2,
      );
      assert.equal(call.search, false);
      return result(output({ shortlist: [0, 1, 2, 3, 4].map(assessment) }));
    },
  );
  assert.equal(board.status, 'completed');
  assert.equal(board.candidates.length, 5);
  assert.equal(board.totalInputTokens, 500);
  assert.equal(board.totalOutputTokens, 100);
  assert.equal(calls.length, 5);
  assert.equal(new Set(calls.map((call) => call.budget)).size, 1);
  assert.ok(calls.every((call) => call.boardResearch));
  assert.equal(
    board.agents.every((agent) => agent.status === 'completed'),
    true,
  );
  assert.ok(updates.includes('running'));
});

test('one failed scout and unavailable pricing leave a transparent partial board', async () => {
  const board = createThemeBoard('Theme', 'A public evidence driven thematic test.');
  await runThemeBoard(
    board,
    () => {},
    undefined,
    async (call) => {
      if (call.namespace.endsWith('established')) throw new Error('Provider unavailable');
      if (call.namespace.endsWith('emerging'))
        return result(output({ companies: [company(0)], evidence: [evidence(0)] }));
      if (call.namespace.endsWith('ranking'))
        return result(output({ shortlist: [assessment(0), assessment(1)] }));
      return result(output());
    },
  );
  assert.equal(board.status, 'partial');
  assert.equal(board.candidates.length, 1);
  assert.match(board.error || '', /Only 1 companies/);
  assert.match(board.error || '', /Infrastructure Scout/);
  assert.equal(board.agents.find((agent) => agent.id === 'scout-established')?.status, 'failed');
});

test('adversarial correction prevents a company entering the priced shortlist', async () => {
  const board = createThemeBoard('Theme', 'A public evidence driven thematic test.');
  await runThemeBoard(
    board,
    () => {},
    undefined,
    async (call) => {
      if (call.namespace.endsWith('established'))
        return result(output({ companies: [company(0)], evidence: [evidence(0)] }));
      if (call.namespace.endsWith('bear'))
        return result(
          output({
            corrections: [
              {
                evidenceId: 'valuation-0',
                status: 'CONTRADICTED',
                reason: 'Funding amount was mislabelled as valuation',
              },
            ],
          }),
        );
      if (call.namespace.endsWith('ranking')) return result(output({ shortlist: [assessment(0)] }));
      return result(output());
    },
  );
  assert.equal(board.candidates.length, 0);
  assert.equal(board.status, 'partial');
  assert.equal(board.evidence[0].status, 'CONTRADICTED');
  assert.equal(board.evidence[0].correction, 'Funding amount was mislabelled as valuation');
});

test('refresh cannot reuse stale companies or failed agent output as fresh research', async () => {
  const board = createThemeBoard('Theme', 'A public evidence driven thematic test.');
  board.candidates = assembleCandidates({ evidence: [evidence(0)] }, [company(0)], [assessment(0)]);
  board.evidence = [evidence(0)];
  board.summary = 'Previous completed ranking';
  board.totalInputTokens = 500;
  board.status = 'completed';
  board.agents[0].output = output({ companies: [company(0)], evidence: [evidence(0)] });
  await runThemeBoard(
    board,
    () => {},
    undefined,
    async () => {
      throw new Error('Fresh provider unavailable');
    },
  );
  assert.equal(board.status, 'failed');
  assert.equal(board.candidates.length, 0);
  assert.equal(board.evidence.length, 0);
  assert.equal(
    board.agents.every((agent) => !agent.output),
    true,
  );
  assert.equal(board.previousRanking?.candidates[0].company.name, 'TestCo 0');
  assert.equal(board.previousRanking?.totalInputTokens, 500);
  assert.equal(board.totalInputTokens, 0);
});
