import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENTS, type AgentOutput, type Investigation } from '../shared/types.js';
import {
  admitEvidence,
  canonicalUrl,
  extractSearchSources,
  parseAgentOutput,
  requestClaude,
  ResearchError,
  runClaudeAgent,
  TokenBudget,
  type ClaudeResponse,
} from '../server/claude.js';
import {
  completeAssessment,
  challengeAssessment,
  runInvestigation,
  scanSignals,
} from '../server/orchestrator.js';

const source = { url: 'https://example.org/research', title: 'Retrieved primary document' };
const fixture = (): AgentOutput => ({
  summary: 'A documented change creates a testable demand hypothesis.',
  findings: [
    {
      title: 'Documented change',
      detail: 'A source reports a specific development.',
      evidenceIds: ['source-1'],
      kind: 'FACT',
    },
  ],
  evidence: [
    {
      id: 'source-1',
      claim: 'A specific development occurred.',
      url: source.url,
      title: 'Model title',
      publisher: 'Model publisher',
      publishedAt: null,
      retrievedAt: '2026-01-01',
      summary: 'A concise source paraphrase.',
      type: 'OFFICIAL_DOCUMENT',
      status: 'SUPPORTED',
    },
  ],
  companies: [
    {
      id: 'company-1',
      name: 'Example Company',
      website: 'https://example.org',
      description: 'A company described in the test fixture.',
      category: 'Infrastructure',
      alignment: 'Documented change creates demand.',
      strengths: ['Technical alignment'],
      uncertainty: 'Commercial demand remains unknown.',
      confidence: 'LOW',
      evidenceIds: ['source-1'],
    },
  ],
  causalChain: [
    { label: 'New demand may emerge.', status: 'REASONED HYPOTHESIS', evidenceIds: ['source-1'] },
  ],
  questions: ['Does demand convert into revenue?'],
  confidence: 'LOW',
  disputedClaim: 'The development creates commercial demand.',
  verification: 'PARTIALLY SUPPORTED',
  revision: 'The thesis is narrowed to a demand hypothesis.',
  decision: 'MONITOR',
});
const response = (output = fixture(), searched = true): ClaudeResponse => ({
  content: [
    ...(searched
      ? [
          {
            type: 'server_tool_use',
            id: 'srvtoolu_test',
            name: 'web_search',
            input: { query: 'primary source' },
          },
          {
            type: 'web_search_tool_result',
            tool_use_id: 'srvtoolu_test',
            content: [{ type: 'web_search_result', ...source }],
          },
        ]
      : []),
    { type: 'text', text: JSON.stringify(output) },
  ],
  stop_reason: 'end_turn',
  usage: { input_tokens: 200, output_tokens: 100 },
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const fakeKey = () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key-not-a-credential';
  return () => {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous;
  };
};

const recoverableAssessment = (): Investigation => {
  const output = fixture();
  const stamp = new Date().toISOString();
  return {
    id: 'recover-assessment',
    title: 'A completed research graph',
    query: 'Research a documented change',
    company: output.companies![0],
    mode: 'live',
    status: 'partial',
    createdAt: stamp,
    completedAt: stamp,
    agents: AGENTS.map(({ id }) =>
      id === 'committee'
        ? { id, status: 'failed', error: 'Investigation token budget reached.' }
        : {
            id,
            status: 'completed',
            output: structuredClone(output),
            searches: id === 'verifier' ? 1 : 0,
          },
    ),
    events: [
      {
        id: 'original-bull',
        investigationId: 'recover-assessment',
        timestamp: stamp,
        agentId: 'bull',
        type: 'agent_completed',
        message: 'Original Bull position',
        payload: { output: structuredClone(output) },
      },
      {
        id: 'revision-bull',
        investigationId: 'recover-assessment',
        timestamp: stamp,
        agentId: 'bull',
        type: 'thesis_revised',
        message: 'Bull feedback revision',
        payload: { output: structuredClone(output), original: structuredClone(output) },
      },
      {
        id: 'fresh-verification',
        investigationId: 'recover-assessment',
        timestamp: stamp,
        agentId: 'verifier',
        type: 'search_completed',
        message: 'Actual verifier search',
        payload: { sources: [source] },
      },
      {
        id: 'failed-committee',
        investigationId: 'recover-assessment',
        timestamp: stamp,
        agentId: 'committee',
        type: 'agent_failed',
        message: 'Investigation token budget reached.',
        payload: { code: 'TOKEN_BUDGET' },
      },
    ],
    evidence: structuredClone(output.evidence),
    confidence: 'LOW',
    error: 'Investigation token budget reached.',
    watched: false,
    totalInputTokens: 200000,
    totalOutputTokens: 14203,
  };
};

test('JSON extraction recovers fences and enclosing text but rejects invalid schema', () => {
  assert.equal(
    parseAgentOutput(`\`\`\`json\n${JSON.stringify(fixture())}\n\`\`\``).summary,
    fixture().summary,
  );
  assert.equal(
    parseAgentOutput(`Research follows:\n${JSON.stringify(fixture())}\nEnd.`).findings.length,
    1,
  );
  assert.throws(() => parseAgentOutput('{"summary":"Incomplete"}'), /invalid research structure/);
});

test('enum presentation normalization preserves evidence URLs, claims, and IDs exactly', () => {
  const raw = JSON.parse(JSON.stringify(fixture()));
  raw.confidence = ' medium ';
  raw.findings[0].kind = ' company_claim ';
  raw.evidence[0].type = ' official document ';
  raw.evidence[0].status = ' unverified ';
  raw.companies[0].confidence = ' low ';
  raw.causalChain[0].status = ' reasoned_hypothesis ';
  raw.verification = ' partially_supported ';
  raw.decision = ' prioritise_research ';
  const parsed = parseAgentOutput(JSON.stringify(raw));
  assert.equal(parsed.confidence, 'MEDIUM');
  assert.equal(parsed.findings[0].kind, 'COMPANY CLAIM');
  assert.equal(parsed.evidence[0].type, 'OFFICIAL_DOCUMENT');
  assert.equal(parsed.evidence[0].status, 'UNVERIFIED');
  assert.equal(parsed.causalChain?.[0].status, 'REASONED HYPOTHESIS');
  assert.equal(parsed.verification, 'PARTIALLY SUPPORTED');
  assert.equal(parsed.decision, 'PRIORITISE RESEARCH');
  assert.equal(parsed.evidence[0].url, raw.evidence[0].url);
  assert.equal(parsed.evidence[0].claim, raw.evidence[0].claim);
  assert.equal(parsed.evidence[0].id, raw.evidence[0].id);
  assert.deepEqual(parsed.findings[0].evidenceIds, raw.findings[0].evidenceIds);
});

test('unknown categorical labels conservatively lose certainty instead of fabricating facts', () => {
  const raw = JSON.parse(JSON.stringify(fixture()));
  raw.findings = ['PROVEN FACT', 'INFERENCE', 'ANALYST_INFERENCE', 'REASONED_HYPOTHESIS'].map(
    (kind) => ({ ...raw.findings[0], kind }),
  );
  raw.confidence = 'ABSOLUTELY CERTAIN';
  raw.evidence[0].status = 'CONFIRMED';
  raw.causalChain[0].status = 'CAUSALLY PROVEN';
  raw.verification = 'TRUE';
  raw.decision = 'BUY NOW';
  raw.companies[0].confidence = 'GUARANTEED';
  const parsed = parseAgentOutput(JSON.stringify(raw));
  assert.deepEqual(
    parsed.findings.map((finding) => finding.kind),
    ['UNKNOWN', 'HYPOTHESIS', 'HYPOTHESIS', 'HYPOTHESIS'],
  );
  assert.equal(parsed.confidence, 'INSUFFICIENT');
  assert.equal(parsed.evidence[0].status, 'UNVERIFIED');
  assert.equal(parsed.causalChain?.[0].status, 'SPECULATIVE');
  assert.equal(parsed.verification, 'UNRESOLVED');
  assert.equal(parsed.decision, 'INSUFFICIENT EVIDENCE');
  assert.equal(parsed.companies?.[0].confidence, 'INSUFFICIENT');
});

test('missing or non-string categorical fields remain structural errors and unknown source types are rejected', () => {
  const mutations = [
    (raw: any) => {
      delete raw.confidence;
    },
    (raw: any) => {
      delete raw.findings[0].kind;
    },
    (raw: any) => {
      raw.findings[0].kind = 42;
    },
    (raw: any) => {
      raw.evidence[0].status = null;
    },
    (raw: any) => {
      raw.verification = false;
    },
    (raw: any) => {
      raw.evidence[0].type = 'UNSPECIFIED WEBSITE';
    },
  ];
  for (const mutate of mutations) {
    const raw = JSON.parse(JSON.stringify(fixture()));
    mutate(raw);
    assert.throws(
      () => parseAgentOutput(JSON.stringify(raw)),
      (error) => error instanceof ResearchError && error.diagnostic?.kind === 'INVALID_SCHEMA',
    );
  }
  const optional = fixture();
  delete optional.verification;
  delete optional.decision;
  assert.equal(parseAgentOutput(JSON.stringify(optional)).verification, undefined);
});

test('a harmless inference label is normalized without another paid model request', async () => {
  const restore = fakeKey();
  let calls = 0;
  let recoveries = 0;
  try {
    const value = response();
    const raw = JSON.parse(String(value.content.at(-1)?.text));
    raw.findings[0].kind = 'ANALYST_INFERENCE';
    value.content.at(-1)!.text = JSON.stringify(raw);
    const result = await runClaudeAgent({
      namespace: 'enum',
      role: 'Scout',
      task: 'Research',
      context: {},
      previousEvidence: [],
      budget: new TokenBudget(),
      onDiagnostic: () => recoveries++,
      fetcher: (async () => {
        calls++;
        return json(value);
      }) as typeof fetch,
    });
    assert.equal(calls, 1);
    assert.equal(recoveries, 0);
    assert.equal(result.output.findings[0].kind, 'HYPOTHESIS');
    assert.equal(result.output.evidence[0].url, source.url);
  } finally {
    restore();
  }
});

test('only protocol-defined search results and citations admit URLs', () => {
  const sources = extractSearchSources([
    {
      type: 'text',
      text: 'https://fabricated.example/never-searched',
      citations: [
        {
          type: 'web_search_result_location',
          url: 'https://example.org/citation',
          title: 'Citation',
        },
      ],
    },
    { type: 'tool_use', url: 'https://fabricated.example/tool' },
    ...response().content,
  ]);
  assert.deepEqual(
    sources.map((s) => s.url).sort(),
    ['https://example.org/citation', source.url].sort(),
  );
  assert.equal(canonicalUrl('javascript:alert(1)'), undefined);
  assert.equal(canonicalUrl('https://user:password@example.org'), undefined);
});

test('evidence admission excludes fabricated citations and downgrades unsupported facts', () => {
  const output = fixture();
  output.evidence[0].url = 'https://made-up.example/research';
  const admitted = admitEvidence(output, [source], [], 'scout');
  assert.equal(admitted.rejected, 1);
  assert.equal(admitted.output.evidence.length, 0);
  assert.equal(admitted.output.findings[0].kind, 'UNKNOWN');
  assert.deepEqual(admitted.output.findings[0].evidenceIds, []);
  assert.equal(admitted.output.confidence, 'INSUFFICIENT');
  assert.equal(admitted.output.companies?.length, 0);
});

test('admission namespaces citation IDs and retains source-backed prior references', () => {
  const first = admitEvidence(fixture(), [source], [], 'scout').output;
  assert.match(first.evidence[0].id, /^scout-/);
  assert.equal(first.findings[0].evidenceIds[0], first.evidence[0].id);
  assert.equal(first.evidence[0].title, source.title);
  assert.equal(first.evidence[0].publisher, 'example.org');
  const second = fixture();
  second.evidence = [];
  second.findings[0].evidenceIds = [first.evidence[0].id, 'fabricated-id'];
  second.companies![0].website = 'https://unretrieved.example';
  const result = admitEvidence(second, [], first.evidence, 'bull').output;
  assert.deepEqual(result.findings[0].evidenceIds, [first.evidence[0].id]);
  assert.equal(result.companies?.length, 0);
});

test('token budget reserves concurrent work and blocks further calls after actual usage limit', () => {
  const budget = new TokenBudget(100);
  const release = budget.reserve(70);
  assert.throws(() => budget.reserve(31), /budget reached/);
  release();
  release();
  budget.add(40, 30);
  assert.throws(() => budget.reserve(31), /budget reached/);
  assert.throws(() => budget.add(31, 0), /budget reached/);
});

test('transport retries 429 and server failure, while preserving authorization only in headers', async () => {
  const restore = fakeKey();
  const requests: Record<string, unknown>[] = [];
  let calls = 0;
  try {
    const result = await requestClaude({ model: 'test', messages: [] }, undefined, (async (
      _url,
      init,
    ) => {
      requests.push(JSON.parse(String(init?.body)));
      calls++;
      if (calls === 1)
        return new Response('', { status: 429, headers: { 'retry-after': '0.001' } });
      if (calls === 2)
        return new Response('', { status: 503, headers: { 'retry-after': '0.001' } });
      return json(response());
    }) as typeof fetch);
    assert.equal(calls, 3);
    assert.equal(result.stop_reason, 'end_turn');
    assert.ok(!JSON.stringify(requests).includes('test-key'));
  } finally {
    restore();
  }
});

test('transport cancellation interrupts rate-limit backoff and missing keys fail without network', async () => {
  const restore = fakeKey();
  const controller = new AbortController();
  let calls = 0;
  try {
    const result = requestClaude({}, controller.signal, (async () => {
      calls++;
      setTimeout(() => controller.abort(), 5);
      return new Response('', { status: 429 });
    }) as typeof fetch);
    await assert.rejects(result, { name: 'AbortError' });
    assert.equal(calls, 1);
    delete process.env.ANTHROPIC_API_KEY;
    await assert.rejects(
      requestClaude({}, undefined, (async () => {
        throw new Error('Network must not run');
      }) as typeof fetch),
      /Set ANTHROPIC_API_KEY/,
    );
  } finally {
    restore();
  }
});

test('pause_turn continues exact assistant content, accounts usage, and counts actual tools', async () => {
  const restore = fakeKey();
  const bodies: Record<string, unknown>[] = [];
  let calls = 0;
  const paused = {
    content: [{ type: 'text', text: 'Working.' }],
    stop_reason: 'pause_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
  };
  try {
    const result = await runClaudeAgent({
      namespace: 'test',
      role: 'Scout',
      task: 'Research',
      context: {},
      previousEvidence: [],
      budget: new TokenBudget(),
      fetcher: (async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return json(++calls === 1 ? paused : response());
      }) as typeof fetch,
    });
    assert.equal(calls, 2);
    assert.equal(result.inputTokens, 210);
    assert.equal(result.outputTokens, 105);
    assert.equal(result.searches, 1);
    assert.deepEqual((bodies[1].messages as { content: unknown }[])[1].content, paused.content);
    assert.equal((bodies[1].tools as { max_uses: number }[])[0].max_uses, 2);
  } finally {
    restore();
  }
});

test('invalid structured output gets one bounded repair with web search disabled', async () => {
  const restore = fakeKey();
  const bodies: Record<string, unknown>[] = [];
  let calls = 0;
  try {
    const result = await runClaudeAgent({
      namespace: 'repair',
      role: 'Scout',
      task: 'Research',
      context: {},
      previousEvidence: [],
      budget: new TokenBudget(),
      fetcher: (async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        const value = response();
        if (++calls === 1) value.content[value.content.length - 1].text = '{"broken":';
        else value.content = value.content.filter((b) => b.type === 'text');
        return json(value);
      }) as typeof fetch,
    });
    assert.equal(calls, 2);
    assert.equal(bodies[1].tools, undefined);
    assert.equal(result.searches, 1);
    assert.equal(result.output.evidence.length, 1);
  } finally {
    restore();
  }
});

test('verifier requires fresh search even when previous validated evidence exists', async () => {
  const restore = fakeKey();
  let calls = 0;
  const prior = admitEvidence(fixture(), [source], [], 'prior').output.evidence;
  try {
    const result = await runClaudeAgent({
      namespace: 'verifier',
      role: 'Verifier',
      task: 'Verify',
      context: {},
      previousEvidence: prior,
      budget: new TokenBudget(),
      requireSearch: true,
      fetcher: (async () => json(response(fixture(), ++calls > 1))) as typeof fetch,
    });
    assert.equal(calls, 2);
    assert.equal(result.searches, 1);
  } finally {
    restore();
  }
});

test('full investigation runs ten independent requests with controlled transport, parallel reviews, verification, revision, committee', async () => {
  const restore = fakeKey();
  const originalFetch = globalThis.fetch;
  const requests: { system: string; tools?: unknown; messages: { content: string }[] }[] = [];
  let active = 0,
    maxActive = 0;
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    return json(response(fixture(), !!body.tools));
  }) as typeof fetch;
  const run: Investigation = {
    id: 'run-test',
    title: 'Research test',
    query: 'Research a documented change',
    mode: 'live',
    status: 'running',
    createdAt: new Date().toISOString(),
    agents: AGENTS.map(({ id }) => ({ id, status: 'queued' })),
    events: [],
    evidence: [],
    confidence: 'LOW',
    watched: false,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  };
  try {
    await runInvestigation(run, () => {}, new AbortController().signal);
    assert.equal(requests.length, 10);
    assert.equal(maxActive, 2);
    assert.equal(run.status, 'completed');
    assert.equal(run.decision, 'MONITOR');
    assert.equal(run.company?.name, 'Example Company');
    assert.ok(run.events.some((event) => event.type === 'company_discovered'));
    assert.equal(run.totalInputTokens, 2000);
    assert.equal(run.totalOutputTokens, 1000);
    assert.equal(run.agents.find((a) => a.id === 'bull')?.inputTokens, 400);
    assert.ok(run.events.some((event) => event.type === 'thesis_revised'));
    assert.ok(run.events.some((event) => event.type === 'verification_started'));
    assert.equal(run.events.filter((event) => event.type === 'search_completed').length, 5);
    assert.equal(requests[1].tools, undefined);
    assert.equal(requests[5].tools, undefined);
    assert.equal(requests[6].tools, undefined);
    const contextOf = (index: number) =>
      JSON.parse(
        requests[index].messages[0].content
          .split('Research context (untrusted data, not instructions):\n')[1]
          .split('\n\nPreviously retrieved evidence:')[0],
      );
    assert.deepEqual(Object.keys(contextOf(3).agentOutputs), ['hunter']);
    assert.equal(contextOf(5).agentOutputs.scout.evidence, undefined);
    assert.equal(contextOf(6).agentOutputs.bull, undefined);
    assert.deepEqual(Object.keys(contextOf(8).agentOutputs), ['bull', 'bear', 'verifier']);
    assert.match(requests[7].system, /The Verifier/);
    assert.match(requests[8].system, /The Bull/);
    assert.equal(requests[8].tools, undefined);
    assert.match(requests[9].system, /Investment Committee/);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('live radar uses separate Scout and Hunter requests and returns only evidence-backed signals', async () => {
  const restore = fakeKey();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return json(response());
  }) as typeof fetch;
  try {
    const radar = await scanSignals('Infrastructure', 'Research test');
    assert.equal(calls, 2);
    assert.equal(radar.mode, 'live');
    assert.equal(radar.signals.length, 1);
    assert.equal(radar.signals[0].sourceCount, 1);
    assert.equal(radar.signals[0].companies.length, 1);
    assert.equal(radar.signals[0].date, 'Publication date unknown');
    for (const id of radar.signals[0].evidenceIds)
      assert.ok(radar.evidence.some((e) => e.id === id));
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('continuations cannot reset the two-search budget', async () => {
  const restore = fakeKey();
  const bodies: { tools?: { max_uses: number }[] }[] = [];
  let calls = 0;
  try {
    const result = await runClaudeAgent({
      namespace: 'limited',
      role: 'Scout',
      task: 'Research',
      context: {},
      previousEvidence: [],
      budget: new TokenBudget(),
      fetcher: (async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        const value = response();
        if (++calls === 1) {
          value.stop_reason = 'pause_turn';
          value.content = value.content.slice(0, 2);
        }
        return json(value);
      }) as typeof fetch,
    });
    assert.equal(result.searches, 2);
    assert.equal(bodies[0].tools?.[0].max_uses, 2);
    assert.equal(bodies[1].tools?.[0].max_uses, 1);
  } finally {
    restore();
  }
});

test('missing explicit verifier outcome keeps the run partial despite a committee decision', async () => {
  const restore = fakeKey();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const output = fixture();
    if (String(body.system).includes('You are The Verifier')) delete output.verification;
    return json(response(output, !!body.tools));
  }) as typeof fetch;
  const run: Investigation = {
    id: 'run-gap',
    title: 'Research test',
    query: 'Research a documented change',
    mode: 'live',
    status: 'running',
    createdAt: new Date().toISOString(),
    agents: AGENTS.map(({ id }) => ({ id, status: 'queued' })),
    events: [],
    evidence: [],
    confidence: 'LOW',
    watched: false,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  };
  try {
    await runInvestigation(run, () => {}, new AbortController().signal);
    assert.equal(run.status, 'partial');
    assert.equal(run.agents.find((a) => a.id === 'verifier')?.output?.verification, 'UNRESOLVED');
    assert.match(run.error || '', /verification outcome/);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('failed fresh search cannot verify a claim using earlier evidence or reused text citations', async () => {
  const restore = fakeKey();
  const originalFetch = globalThis.fetch;
  let bullRevisionSawGap = false;
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const output = fixture();
    if (String(body.system).includes('You are The Verifier')) {
      output.verification = 'SUPPORTED';
      const value = response(output);
      value.content[1].content = {
        type: 'web_search_tool_result_error',
        error_code: 'unavailable',
      };
      value.content[2].citations = [{ type: 'web_search_result_location', ...source }];
      return json(value);
    }
    if (String(body.system).includes('You are The Bull') && !body.tools)
      bullRevisionSawGap = String(body.messages[0].content).includes(
        'Fresh web search returned no usable source results.',
      );
    return json(response(output, !!body.tools));
  }) as typeof fetch;
  const run: Investigation = {
    id: 'run-search-gap',
    title: 'Research test',
    query: 'Research a documented change',
    mode: 'live',
    status: 'running',
    createdAt: new Date().toISOString(),
    agents: AGENTS.map(({ id }) => ({ id, status: 'queued' })),
    events: [],
    evidence: [],
    confidence: 'LOW',
    watched: false,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  };
  try {
    await runInvestigation(run, () => {}, new AbortController().signal);
    const verifier = run.agents.find((agent) => agent.id === 'verifier')!;
    assert.equal(verifier.searches, 1);
    assert.equal(verifier.status, 'completed');
    assert.equal(verifier.output?.verification, 'UNRESOLVED');
    assert.equal(run.status, 'partial');
    assert.match(verifier.output?.summary || '', /no usable source results/);
    assert.equal(bullRevisionSawGap, true);
    const event = run.events.find(
      (event) => event.agentId === 'verifier' && event.type === 'search_completed',
    );
    assert.deepEqual((event?.payload as { sources: unknown[] }).sources, []);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('a successful fresh search without cited fresh evidence cannot substantiate verification', async () => {
  const restore = fakeKey();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const output = fixture();
    const value = response(output, !!body.tools);
    if (String(body.system).includes('You are The Verifier')) {
      output.verification = 'SUPPORTED';
      value.content[1].content = [
        {
          type: 'web_search_result',
          title: 'Uncited fresh result',
          url: 'https://example.org/fresh-material',
        },
      ];
    }
    return json(value);
  }) as typeof fetch;
  const run: Investigation = {
    id: 'run-uncited-gap',
    title: 'Research test',
    query: 'Research a documented change',
    mode: 'live',
    status: 'running',
    createdAt: new Date().toISOString(),
    agents: AGENTS.map(({ id }) => ({ id, status: 'queued' })),
    events: [],
    evidence: [],
    confidence: 'LOW',
    watched: false,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  };
  try {
    await runInvestigation(run, () => {}, new AbortController().signal);
    const verifier = run.agents.find((agent) => agent.id === 'verifier')!;
    assert.equal(verifier.output?.verification, 'UNRESOLVED');
    assert.equal(run.status, 'partial');
    assert.match(verifier.output?.summary || '', /cite no freshly retrieved source evidence/);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('a refreshed source can be cited by its prior evidence ID, while an unrelated fresh result cannot verify that reference', async () => {
  const restore = fakeKey();
  const originalFetch = globalThis.fetch;
  try {
    for (const refreshesCitedSource of [true, false]) {
      globalThis.fetch = (async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        const output = fixture();
        const isVerifier = String(body.system).includes('You are The Verifier');
        if (isVerifier) {
          const priorId = String(body.messages[0].content).match(/scout-[a-f0-9]{12}/)?.[0];
          assert.ok(priorId, 'Verifier receives the admitted Scout citation ID');
          output.evidence = [];
          output.findings[0].evidenceIds = [priorId];
          output.verification = 'SUPPORTED';
        }
        const value = response(output, !!body.tools);
        if (isVerifier && !refreshesCitedSource)
          value.content[1].content = [
            {
              type: 'web_search_result',
              title: 'A different source',
              url: 'https://example.org/unrelated-fresh-source',
            },
          ];
        return json(value);
      }) as typeof fetch;
      const run: Investigation = {
        id: `refresh-${refreshesCitedSource}`,
        title: 'Research test',
        query: 'Research a documented change',
        mode: 'live',
        status: 'running',
        createdAt: new Date().toISOString(),
        agents: AGENTS.map(({ id }) => ({ id, status: 'queued' })),
        events: [],
        evidence: [],
        confidence: 'LOW',
        watched: false,
        totalInputTokens: 0,
        totalOutputTokens: 0,
      };
      await runInvestigation(run, () => {}, new AbortController().signal);
      const verifier = run.agents.find((agent) => agent.id === 'verifier')!;
      assert.equal(verifier.output?.evidence.length, 0);
      assert.match(verifier.output?.findings[0].evidenceIds[0] || '', /^scout-/);
      assert.equal(
        verifier.output?.verification,
        refreshesCitedSource ? 'SUPPORTED' : 'UNRESOLVED',
      );
      assert.equal(run.status, refreshesCitedSource ? 'completed' : 'partial');
    }
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('cancellation preserves a clear terminal state and does not issue queued stage requests', async () => {
  const controller = new AbortController();
  controller.abort();
  const run: Investigation = {
    id: 'cancelled',
    title: 'Research test',
    query: 'Research a documented change',
    mode: 'live',
    status: 'running',
    createdAt: new Date().toISOString(),
    agents: AGENTS.map(({ id }) => ({ id, status: 'queued' })),
    events: [],
    evidence: [],
    confidence: 'LOW',
    watched: false,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  };
  await runInvestigation(run, () => {}, controller.signal);
  assert.equal(run.status, 'cancelled');
  assert.equal(run.totalInputTokens, 0);
  assert.ok(run.events.some((e) => e.type === 'investigation_cancelled'));
});

test('an uncorroborated supplied company domain cannot become a completed company assessment', async () => {
  const restore = fakeKey();
  const originalFetch = globalThis.fetch;
  let founderUsedSearch = false;
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(body.system).includes('You are Founder Analyst')) founderUsedSearch = !!body.tools;
    return json(response(fixture(), !!body.tools));
  }) as typeof fetch;
  const supplied = { ...fixture().companies![0], website: 'https://unretrieved.invalid' };
  const run: Investigation = {
    id: 'identity-gap',
    title: 'Research test',
    query: 'Research Example Company',
    company: supplied,
    mode: 'live',
    status: 'running',
    createdAt: new Date().toISOString(),
    agents: AGENTS.map(({ id }) => ({ id, status: 'queued' })),
    events: [],
    evidence: [],
    confidence: 'LOW',
    watched: false,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  };
  try {
    await runInvestigation(run, () => {}, new AbortController().signal);
    assert.equal(run.status, 'partial');
    assert.equal(run.decision, 'INSUFFICIENT EVIDENCE');
    assert.equal(run.company, undefined);
    assert.equal(founderUsedSearch, false);
    assert.ok(
      run.events.some(
        (event) =>
          event.type === 'company_discovery_incomplete' &&
          event.message.includes('not corroborated'),
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('a successful Bull revision cannot erase the initial Bull stage failure', async () => {
  const restore = fakeKey();
  const originalFetch = globalThis.fetch;
  let bullCalls = 0;
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(body.system).includes('You are The Bull') && ++bullCalls === 1)
      return json({ error: 'Controlled initial Bull failure' }, 400);
    return json(response(fixture(), !!body.tools));
  }) as typeof fetch;
  const run: Investigation = {
    id: 'bull-gap',
    title: 'Research test',
    query: 'Research a documented change',
    mode: 'live',
    status: 'running',
    createdAt: new Date().toISOString(),
    agents: AGENTS.map(({ id }) => ({ id, status: 'queued' })),
    events: [],
    evidence: [],
    confidence: 'LOW',
    watched: false,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  };
  try {
    await runInvestigation(run, () => {}, new AbortController().signal);
    assert.equal(run.agents.find((agent) => agent.id === 'bull')?.status, 'completed');
    assert.equal(run.status, 'partial');
    assert.ok(
      run.events.some((event) => event.agentId === 'bull' && event.type === 'agent_failed'),
    );
    assert.ok(run.events.some((event) => event.type === 'thesis_revised'));
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('citation boundaries preserve JSON string contents when text blocks are concatenated', async () => {
  const restore = fakeKey();
  try {
    const value = response();
    const text = JSON.stringify(fixture());
    const boundary = text.indexOf('documented') + 5;
    value.content = [
      ...value.content.slice(0, 2),
      {
        type: 'text',
        text: text.slice(0, boundary),
        citations: [{ type: 'web_search_result_location', ...source }],
      },
      { type: 'text', text: text.slice(boundary) },
    ];
    const result = await runClaudeAgent({
      namespace: 'split',
      role: 'Scout',
      task: 'Research',
      context: {},
      previousEvidence: [],
      budget: new TokenBudget(),
      fetcher: (async () => json(value)) as typeof fetch,
    });
    assert.equal(result.output.summary, fixture().summary);
  } finally {
    restore();
  }
});

test('output truncation recovers once without resending encrypted search documents', async () => {
  const restore = fakeKey();
  const bodies: Record<string, unknown>[] = [];
  const diagnostics: unknown[] = [];
  let calls = 0;
  try {
    const result = await runClaudeAgent({
      namespace: 'truncated',
      role: 'Scout',
      task: 'Research',
      context: {},
      previousEvidence: [],
      budget: new TokenBudget(),
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      fetcher: (async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        const value = response(fixture(), calls === 0);
        if (++calls === 1) {
          value.stop_reason = 'max_tokens';
          (value.content[1].content as Record<string, unknown>[])[0].encrypted_content =
            'ENCRYPTED_DOCUMENT_DATA_NOT_NEEDED';
        }
        return json(value);
      }) as typeof fetch,
    });
    assert.equal(calls, 2);
    assert.equal(result.searches, 1);
    assert.deepEqual(diagnostics, [{ kind: 'OUTPUT_TRUNCATED', stopReason: 'max_tokens' }]);
    assert.equal(bodies[0].max_tokens, 5000);
    assert.equal(JSON.stringify(bodies[1]).includes('ENCRYPTED_DOCUMENT_DATA_NOT_NEEDED'), false);
  } finally {
    restore();
  }
});

test('radar companies map by their exact signal title rather than shared source IDs', async () => {
  const restore = fakeKey();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const output = fixture();
    if (++calls === 1)
      output.findings = [
        { ...output.findings[0], title: 'First development' },
        { ...output.findings[0], title: 'Second development' },
      ];
    else {
      output.companies![0].alignment = 'First development creates demand.';
      const sharedId = String(body.messages[0].content).match(/radar-scout-[a-f0-9]{12}/)?.[0];
      if (sharedId) output.companies![0].evidenceIds.push(sharedId);
    }
    return json(response(output));
  }) as typeof fetch;
  try {
    const radar = await scanSignals('Infrastructure');
    assert.equal(radar.signals[0].companies.length, 1);
    assert.equal(radar.signals[1].companies.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('assessment recovery calls only the committee, preserves prior failures, and accounts all earlier usage', async () => {
  const restore = fakeKey();
  const originalFetch = globalThis.fetch;
  const previousLimit = process.env.MAX_INVESTIGATION_TOKENS;
  process.env.MAX_INVESTIGATION_TOKENS = '300000';
  let calls = 0;
  const run = recoverableAssessment();
  globalThis.fetch = (async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.match(body.system, /Investment Committee/);
    assert.equal(body.tools, undefined);
    assert.match(body.messages[0].content, /originalBull/);
    assert.match(body.messages[0].content, /bullRevision/);
    return json(response(fixture(), false));
  }) as typeof fetch;
  try {
    const promise = completeAssessment(run, () => {}, new AbortController().signal);
    assert.equal(run.status, 'running');
    await promise;
    assert.equal(calls, 1);
    assert.equal(run.status, 'completed');
    assert.equal(run.decision, 'MONITOR');
    assert.equal(run.totalInputTokens, 200200);
    assert.equal(run.totalOutputTokens, 14303);
    assert.equal(run.events.filter((event) => event.type === 'assessment_resumed').length, 1);
    assert.equal(run.events.filter((event) => event.type === 'agent_started').length, 1);
    assert.ok(
      run.events.some((event) => event.id === 'failed-committee' && event.type === 'agent_failed'),
    );
    assert.equal(run.error, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
    if (previousLimit === undefined) delete process.env.MAX_INVESTIGATION_TOKENS;
    else process.env.MAX_INVESTIGATION_TOKENS = previousLimit;
  }
});

test('assessment recovery respects total run usage before issuing another paid request', async () => {
  const restore = fakeKey();
  const originalFetch = globalThis.fetch;
  const previousLimit = process.env.MAX_INVESTIGATION_TOKENS;
  process.env.MAX_INVESTIGATION_TOKENS = '214203';
  let calls = 0;
  const run = recoverableAssessment();
  globalThis.fetch = (async () => {
    calls++;
    return json(response());
  }) as typeof fetch;
  try {
    await completeAssessment(run, () => {}, new AbortController().signal);
    assert.equal(calls, 0);
    assert.equal(run.status, 'partial');
    assert.equal(run.totalInputTokens + run.totalOutputTokens, 214203);
    assert.match(run.error || '', /token budget reached/);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
    if (previousLimit === undefined) delete process.env.MAX_INVESTIGATION_TOKENS;
    else process.env.MAX_INVESTIGATION_TOKENS = previousLimit;
  }
});

test('assessment recovery rejects incomplete research, unknown company identity, or missing fresh verifier provenance', async () => {
  const invalidRuns = [
    recoverableAssessment(),
    recoverableAssessment(),
    recoverableAssessment(),
    recoverableAssessment(),
  ];
  invalidRuns[0].agents.find((agent) => agent.id === 'bear')!.status = 'failed';
  invalidRuns[1].company = { ...invalidRuns[1].company!, website: 'https://unretrieved.invalid' };
  invalidRuns[2].events.find((event) => event.agentId === 'verifier')!.payload = { sources: [] };
  invalidRuns[3].events = invalidRuns[3].events.filter((event) => event.type !== 'thesis_revised');
  for (const run of invalidRuns) {
    await assert.rejects(
      completeAssessment(run, () => {}, new AbortController().signal),
      (error) => error instanceof ResearchError && error.code === 'ASSESSMENT_NOT_RECOVERABLE',
    );
    assert.equal(run.status, 'partial');
    assert.equal(run.totalInputTokens + run.totalOutputTokens, 214203);
  }
});

test('bounded claim challenge corrects evidence atomically and makes only verifier, Bull, committee requests', async () => {
  const restore = fakeKey();
  const originalFetch = globalThis.fetch;
  const previousLimit = process.env.MAX_INVESTIGATION_TOKENS;
  process.env.MAX_INVESTIGATION_TOKENS = '400000';
  const run = recoverableAssessment();
  const originalClaim = run.evidence[0].claim;
  const roles: string[] = [];
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const output = fixture();
    const verifier = String(body.system).includes('You are The Verifier');
    roles.push(
      verifier
        ? 'verifier'
        : String(body.system).includes('You are The Bull')
          ? 'bull'
          : 'committee',
    );
    if (verifier) {
      output.corrections = [
        {
          evidenceId: 'source-1',
          status: 'CONTRADICTED',
          reason: 'The source attributes the customer to a competing company.',
        },
      ];
      output.verification = 'CONTRADICTED';
    } else {
      assert.equal(body.tools, undefined);
      assert.match(body.messages[0].content, /CONTRADICTED/);
    }
    return json(response(output, verifier));
  }) as typeof fetch;
  try {
    await challengeAssessment(
      run,
      () => {},
      new AbortController().signal,
      'The customer belongs to a competitor, not the subject company.',
    );
    assert.deepEqual(roles, ['verifier', 'bull', 'committee']);
    assert.equal(run.status, 'completed');
    assert.equal(run.totalInputTokens + run.totalOutputTokens, 215103);
    assert.equal(run.evidence[0].claim, originalClaim);
    assert.equal(run.evidence[0].status, 'CONTRADICTED');
    assert.match(run.evidence[0].correction!, /competing company/);
    assert.ok(
      run.events.some(
        (e) =>
          e.type === 'evidence_corrected' &&
          (e.payload as { previous: { status: string } }).previous.status === 'SUPPORTED',
      ),
    );
    assert.equal(run.events.filter((e) => e.type === 'thesis_revised').length, 2);
    assert.ok(run.events.some((e) => e.id === 'failed-committee'));
  } finally {
    globalThis.fetch = originalFetch;
    restore();
    if (previousLimit === undefined) delete process.env.MAX_INVESTIGATION_TOKENS;
    else process.env.MAX_INVESTIGATION_TOKENS = previousLimit;
  }
});

test('failed fresh challenge search never rewrites prior evidence', async () => {
  const restore = fakeKey();
  const originalFetch = globalThis.fetch;
  const run = recoverableAssessment();
  const before = JSON.stringify(run.evidence);
  globalThis.fetch = (async () => {
    const value = response();
    value.content[1].content = { type: 'web_search_tool_result_error', error_code: 'unavailable' };
    const output = fixture();
    output.corrections = [
      { evidenceId: 'source-1', status: 'CONTRADICTED', reason: 'Not a verified correction.' },
    ];
    value.content[2].text = JSON.stringify(output);
    return json(value);
  }) as typeof fetch;
  try {
    await challengeAssessment(
      run,
      () => {},
      new AbortController().signal,
      'Test the source attribution again.',
    );
    assert.equal(run.status, 'partial');
    assert.equal(JSON.stringify(run.evidence), before);
    assert.ok(!run.events.some((e) => e.type === 'evidence_corrected'));
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('unknown correction targets cannot modify evidence and the two-round cap prevents further calls', async () => {
  const restore = fakeKey();
  const originalFetch = globalThis.fetch;
  const run = recoverableAssessment();
  const before = JSON.stringify(run.evidence);
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    const output = fixture();
    output.corrections = [
      { evidenceId: 'unretrieved-id', status: 'CONTRADICTED', reason: 'Unknown target.' },
    ];
    return json(response(output));
  }) as typeof fetch;
  try {
    await challengeAssessment(
      run,
      () => {},
      new AbortController().signal,
      'Review this unsupported source attribution.',
    );
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(run.evidence), before);
    assert.equal(run.status, 'partial');
    const capped = recoverableAssessment();
    for (let i = 0; i < 2; i++)
      capped.events.push({
        id: `round-${i}`,
        investigationId: capped.id,
        timestamp: new Date().toISOString(),
        agentId: 'verifier',
        type: 'agent_started',
        message: 'Controlled recorded verifier round',
      });
    await assert.rejects(
      challengeAssessment(
        capped,
        () => {},
        new AbortController().signal,
        'Review again after the cap.',
      ),
      /maximum of two/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('a specialist can use a distinct committee model and records the provider model', async () => {
  const restore = fakeKey();
  try {
    const result = await runClaudeAgent({
      namespace: 'committee-model',
      model: 'claude-opus-5-5',
      role: 'Investment Committee',
      task: 'Synthesize existing evidence.',
      context: {},
      previousEvidence: fixture().evidence,
      budget: new TokenBudget(),
      search: false,
      fetcher: (async (_url, init) => {
        assert.equal(JSON.parse(String(init?.body)).model, 'claude-opus-5-5');
        return json({ ...response(fixture(), false), model: 'claude-opus-5-5' });
      }) as typeof fetch,
    });
    assert.equal(result.model, 'claude-opus-5-5');
    assert.equal(result.searches, 0);
  } finally {
    restore();
  }
});
