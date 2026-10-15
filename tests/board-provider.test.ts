import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentOutputSchema, type AgentOutput } from '../shared/types.js';
import {
  admitEvidence,
  runClaudeAgent,
  TokenBudget,
  ResearchError,
  type ClaudeResponse,
} from '../server/claude.js';

const primary = {
  url: 'https://fixture.example/financing',
  title: 'Primary financing announcement fixture',
};
function output(): AgentOutput {
  return {
    summary: 'A controlled historical financing fixture, not investment research.',
    findings: [],
    questions: [],
    confidence: 'LOW',
    evidence: [
      {
        id: 'financing',
        claim: 'Fixture Company announced a $1 billion valuation in May 2025.',
        url: primary.url,
        title: 'Model title',
        publisher: 'Model publisher',
        publishedAt: '2025-05-20',
        retrievedAt: '2026-10-15T00:00:00Z',
        summary: 'Historical disclosed financing mark.',
        type: 'FIRST_PARTY_COMPANY_CLAIM',
        status: 'SUPPORTED',
        company: 'Fixture Company',
      },
    ],
    shortlist: [
      {
        companyId: 'fixture-company',
        rank: 1,
        rationale: 'Research priority with unresolved commercial proof',
        valuation: {
          amountUsd: 1e9,
          asOf: '2025-05',
          label: 'Historical financing valuation',
          round: 'Series B',
          basis: 'UNDISCLOSED_BASIS',
          evidenceIds: ['financing'],
        },
        priceSignal: 'MIXED',
        priceReason: 'No independently verified retention',
        bullCase: 'Demand could expand',
        bearCase: 'Competition could capture value',
        killCriterion: 'Paid adoption fails',
        nextProof: 'Verify retention',
        confidence: 'LOW',
        evidenceIds: ['financing'],
      },
    ],
  };
}
function providerResponse(searches: number, stop_reason = 'end_turn'): ClaudeResponse {
  return {
    model: 'controlled-provider-model',
    stop_reason,
    content: [
      ...Array.from({ length: searches }, (_, index) => [
        {
          type: 'server_tool_use',
          id: `search-${index}`,
          name: 'web_search',
          input: { query: 'controlled primary source' },
        },
        {
          type: 'web_search_tool_result',
          tool_use_id: `search-${index}`,
          content: [{ type: 'web_search_result', ...primary }],
        },
      ]).flat(),
      { type: 'text', text: JSON.stringify(output()) },
    ],
    usage: { input_tokens: 200, output_tokens: 100 },
  };
}
const response = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
function withControlledKey() {
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'controlled-transport-test-value';
  return () => {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous;
  };
}

test('typed shortlist survives parsing and citation admission remaps both price and assessment references', () => {
  const raw = output();
  const parsed = AgentOutputSchema.parse(raw);
  assert.equal(parsed.shortlist?.[0].valuation.amountUsd, 1e9);
  parsed.shortlist![0].evidenceIds.push('invented-assessment-reference');
  parsed.shortlist![0].valuation.evidenceIds.push('invented-price-reference');
  const admitted = admitEvidence(parsed, [primary], [], 'board-scout').output;
  const admittedId = admitted.evidence[0].id;
  assert.match(admittedId, /^board-scout-/);
  assert.deepEqual(admitted.shortlist?.[0].evidenceIds, [admittedId]);
  assert.deepEqual(admitted.shortlist?.[0].valuation.evidenceIds, [admittedId]);
  assert.equal(admitted.shortlist?.[0].valuation.amountUsd, raw.shortlist![0].valuation.amountUsd);
  assert.equal(admitted.shortlist?.[0].valuation.asOf, '2025-05');
  const synthesis = output();
  synthesis.evidence = [];
  synthesis.shortlist![0].evidenceIds = [admittedId];
  synthesis.shortlist![0].valuation.evidenceIds = [admittedId];
  const reused = admitEvidence(synthesis, [], admitted.evidence, 'committee').output;
  assert.deepEqual(reused.shortlist?.[0].valuation.evidenceIds, [admittedId]);
});

test('a ranking cannot retain a company when its valuation or assessment has no admitted source', () => {
  for (const field of ['valuation', 'assessment'] as const) {
    const raw = output();
    if (field === 'valuation') raw.shortlist![0].valuation.evidenceIds = ['invented'];
    else raw.shortlist![0].evidenceIds = ['invented'];
    assert.equal(admitEvidence(raw, [primary], [], 'board').output.shortlist?.length, 0);
  }
  const madeUp = output();
  madeUp.evidence[0].url = 'https://unretrieved.example/financing';
  const excluded = admitEvidence(madeUp, [primary], [], 'board');
  assert.equal(excluded.rejected, 1);
  assert.equal(excluded.output.evidence.length, 0);
  assert.equal(excluded.output.shortlist?.length, 0);
});

test('board provider contract requests four searches and retains sourced structured rankings', async () => {
  const restore = withControlledKey();
  let calls = 0;
  try {
    const result = await runClaudeAgent({
      namespace: 'board',
      role: 'Gap Scout',
      task: 'Find primary financing evidence',
      context: {},
      previousEvidence: [],
      budget: new TokenBudget(),
      boardResearch: true,
      maxSearches: 4,
      requireSearch: true,
      fetcher: (async (_url, init) => {
        calls++;
        const body = JSON.parse(String(init?.body));
        assert.equal(body.tools[0].max_uses, 4);
        assert.equal(body.max_tokens, 8500, 'a five-company source trail has bounded extra output room');
        assert.match(body.system, /at most 8 NEW evidence entries/);
        assert.match(body.system, /shortlist/);
        assert.match(body.messages[0].content, /At most 4 searches/);
        return response(providerResponse(4));
      }) as typeof fetch,
    });
    assert.equal(calls, 1);
    assert.equal(result.searches, 4);
    assert.equal(result.model, 'controlled-provider-model');
    assert.equal(result.inputTokens, 200);
    assert.equal(result.outputTokens, 100);
    assert.equal(result.output.shortlist?.length, 1);
    assert.deepEqual(result.output.shortlist![0].valuation.evidenceIds, [
      result.output.evidence[0].id,
    ]);
  } finally {
    restore();
  }
});

test('four-search allowance stays isolated from default investigations and cannot exceed its own cap', async () => {
  const restore = withControlledKey();
  try {
    for (const [allowed, actual] of [
      [undefined, 4],
      [4, 5],
    ] as const) {
      let calls = 0;
      await assert.rejects(
        runClaudeAgent({
          namespace: 'bounded',
          role: 'Scout',
          task: 'Controlled bounded research',
          context: {},
          previousEvidence: [],
          budget: new TokenBudget(),
          ...(allowed ? { maxSearches: allowed, boardResearch: true } : {}),
          fetcher: (async (_url, init) => {
            calls++;
            const body = JSON.parse(String(init?.body));
            assert.equal(body.tools[0].max_uses, allowed || 2);
            assert.equal(body.max_tokens, allowed ? 8500 : 5000);
            return response(providerResponse(actual));
          }) as typeof fetch,
        }),
        (error) => error instanceof ResearchError && error.code === 'SEARCH_LIMIT',
      );
      assert.equal(calls, 1);
    }
  } finally {
    restore();
  }
});

test('continuations receive only remaining search capacity and stop at the configured bound', async () => {
  const restore = withControlledKey();
  try {
    const capacities: number[] = [];
    let calls = 0;
    const result = await runClaudeAgent({
      namespace: 'continued',
      role: 'Scout',
      task: 'Controlled continuation',
      context: {},
      previousEvidence: [],
      budget: new TokenBudget(),
      boardResearch: true,
      maxSearches: 4,
      fetcher: (async (_url, init) => {
        capacities.push(JSON.parse(String(init?.body)).tools[0].max_uses);
        return response(providerResponse(2, calls++ === 0 ? 'pause_turn' : 'end_turn'));
      }) as typeof fetch,
    });
    assert.deepEqual(capacities, [4, 2]);
    assert.equal(result.searches, 4);
    assert.equal(result.inputTokens, 400);
    let boundedCalls = 0;
    await assert.rejects(
      runClaudeAgent({
        namespace: 'paused-cap',
        role: 'Scout',
        task: 'Controlled pause bound',
        context: {},
        previousEvidence: [],
        budget: new TokenBudget(),
        boardResearch: true,
        maxSearches: 4,
        fetcher: (async () => {
          boundedCalls++;
          return response(providerResponse(2, 'pause_turn'));
        }) as typeof fetch,
      }),
      (error) => error instanceof ResearchError && error.code === 'CONTINUATION_LIMIT',
    );
    assert.equal(boundedCalls, 2);
  } finally {
    restore();
  }
});
