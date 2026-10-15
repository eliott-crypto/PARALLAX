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
import { runInvestigation, scanSignals } from '../server/orchestrator.js';

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
  const requests: { system: string; tools?: unknown }[] = [];
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
    assert.equal(run.events.filter((event) => event.type === 'search_completed').length, 8);
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
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(body.system).includes('You are The Bull') && body.tools)
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
