import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assembleCandidates,
  createThemeBoard,
  runThemeBoard,
  fillThemeBoardGaps,
  replaceUnpricedCandidates,
  resolveThemeBoardIdentities,
  resolveExtraThemeBoardIdentities,
} from '../server/boards.js';
import {
  BoardRequestSchema,
  BoardAssessmentSchema,
  type BoardAssessment,
} from '../shared/boards.js';
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
  assert.match(board.error || '', /Niche Specialist Scout/);
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

test('an autonomous gap scout adds only fresh distinct sourced candidates before normal verification', async () => {
  const board = createThemeBoard(
    'Theme',
    'Infrastructure bottlenecks create a research opportunity.',
  );
  const calls: string[] = [];
  await runThemeBoard(
    board,
    () => {},
    undefined,
    async (call) => {
      calls.push(call.namespace);
      if (call.namespace.endsWith('established'))
        return result(
          output({ companies: [company(0), company(1)], evidence: [evidence(0), evidence(1)] }),
        );
      if (call.namespace.endsWith('emerging'))
        return result(output({ companies: [company(2)], evidence: [evidence(2)] }));
      if (call.namespace.endsWith('scout-gap')) {
        assert.match(call.task, /DISTINCT additional NICHE private companies/);
        assert.equal(call.previousEvidence.length, 3);
        return result(
          output({ companies: [company(3), company(4)], evidence: [evidence(3), evidence(4)] }),
        );
      }
      if (call.namespace.endsWith('ranking'))
        return result(output({ shortlist: [0, 1, 2, 3, 4].map(assessment) }));
      assert.equal(call.previousEvidence.length, 5);
      return result(output());
    },
  );
  assert.equal(board.status, 'completed');
  assert.equal(board.candidates.length, 5);
  assert.equal(board.agents.length, 6);
  assert.equal(board.totalInputTokens, 600);
  assert.equal(calls.filter((id) => id === 'theme-scout-gap').length, 1);
});

test('gap completion preserves prior real research and its cost, then performs fresh checks and ranking', async () => {
  const board = createThemeBoard(
    'Theme',
    'Infrastructure bottlenecks create a research opportunity.',
  );
  board.status = 'partial';
  board.agents[0].status = 'completed';
  board.agents[0].output = output({
    companies: [company(0), company(1), company(2)],
    evidence: [evidence(0), evidence(1), evidence(2)],
  });
  board.agents[0].inputTokens = 900;
  board.evidence = [evidence(0), evidence(1), evidence(2)];
  board.candidates = assembleCandidates(
    board,
    [company(0), company(1), company(2)],
    [assessment(0), assessment(1), assessment(2)],
  );
  board.totalInputTokens = 900;
  const originalScoutOutput = structuredClone(board.agents[0].output);
  const calls: string[] = [];
  await fillThemeBoardGaps(
    board,
    () => {},
    undefined,
    async (call) => {
      calls.push(call.namespace);
      assert.equal(
        call.budget.used,
        900,
        'alternative provider fixture does not consume budget callbacks',
      );
      if (call.namespace.endsWith('scout-gap'))
        return result(
          output({ companies: [company(3), company(4)], evidence: [evidence(3), evidence(4)] }),
        );
      if (call.namespace.endsWith('ranking-gap')) {
        assert.equal(call.search, false);
        return result(output({ shortlist: [0, 1, 2, 3, 4].map(assessment) }));
      }
      assert.equal(call.previousEvidence.length, 5);
      return result(output());
    },
  );
  assert.deepEqual(calls, [
    'theme-scout-gap',
    'theme-valuation-gap',
    'theme-bear-gap',
    'theme-ranking-gap',
  ]);
  assert.equal(board.status, 'completed');
  assert.equal(board.candidates.length, 5);
  assert.equal(board.previousRanking?.candidates.length, 3);
  assert.equal(board.totalInputTokens, 1300);
  assert.deepEqual(board.agents[0].output, originalScoutOutput);
  await assert.rejects(
    fillThemeBoardGaps(board, () => {}),
    /already used/,
  );
});

test('bounded replacements count priced slots, retain prior work and use a limited independent Bear review', async () => {
  const board = createThemeBoard(
    'Theme',
    'Infrastructure bottlenecks create a research opportunity.',
  );
  board.status = 'partial';
  board.evidence = [evidence(0), evidence(1), evidence(2)];
  board.candidates = assembleCandidates(
    board,
    [company(0), company(1), company(2)],
    [assessment(0), assessment(1), assessment(2)],
  );
  board.agents[0].output = output({ companies: [company(0), company(1), company(2)] });
  board.agents[1].output = output({
    companies: [{ ...company(5), funding: 'Valuation not publicly disclosed' }],
  });
  board.totalInputTokens = 560000;
  board.totalOutputTokens = 376;
  board.researchLeads = [
    {
      company: 'Fixture lead',
      url: 'https://primary.example/financing-lead',
      note: 'Externally found, not an admitted source until actual search',
    },
  ];
  const calls: AgentCall[] = [];
  const observedCandidateCounts: number[] = [];
  await replaceUnpricedCandidates(
    board,
    (current) => {
      observedCandidateCounts.push(current.candidates.length);
    },
    undefined,
    async (call) => {
      calls.push(call);
      assert.equal(call.budget.used, 560376);
      if (call.namespace.endsWith('scout-replacement')) {
        assert.match(call.task, /price only 3 companies/);
        const context = call.context as {
          data: { missingSlots: number; externalResearchLeads: { leads: unknown[]; note: string } };
        };
        assert.equal(context.data.missingSlots, 2);
        assert.equal(context.data.externalResearchLeads.leads.length, 1);
        assert.match(context.data.externalResearchLeads.note, /not yet admitted/);
        assert.equal(call.maxSearches, 4);
        return result(
          output({ companies: [company(3), company(4)], evidence: [evidence(3), evidence(4)] }),
        );
      }
      if (call.namespace.endsWith('valuation-replacement')) {
        assert.equal(call.maxSearches, 2);
        assert.equal(call.search, true);
        const context = call.context as { data: { companies: Company[] } };
        assert.ok(
          context.data.companies.every(
            (entry) => !['company-0', 'company-1', 'company-2'].includes(entry.id),
          ),
        );
        return result(output());
      }
      if (call.namespace.endsWith('bear-replacement')) {
        assert.equal(call.search, false);
        assert.match(call.task, /limited adversarial review/);
        return result(output());
      }
      assert.equal(call.namespace, 'theme-ranking-replacement');
      assert.equal(call.search, false);
      return result(output({ shortlist: [0, 1, 2, 3, 4].map(assessment) }));
    },
  );
  assert.equal(calls.length, 4);
  assert.equal(board.status, 'completed');
  assert.equal(board.candidates.length, 5);
  assert.equal(board.totalInputTokens, 560400);
  assert.equal(board.totalOutputTokens, 456);
  assert.ok(observedCandidateCounts.slice(0, -1).includes(3));
  assert.equal(board.agents[0].output?.companies?.length, 3);
  await assert.rejects(
    replaceUnpricedCandidates(board, () => {}),
    /already used/,
  );
});

test('niche preferences default to 100M, accept explicit ceilings and keep evidence-backed tailwind hypotheses typed', () => {
  assert.equal(
    createThemeBoard('Theme', 'A sourced research thesis.').preferredValuationMaxUsd,
    100000000,
  );
  assert.equal(
    createThemeBoard('Theme', 'A sourced research thesis.', 50000000).preferredValuationMaxUsd,
    50000000,
  );
  assert.equal(
    BoardRequestSchema.parse({ title: 'Theme', thesis: 'A sourced research thesis.' })
      .preferredValuationMaxUsd,
    100000000,
  );
  assert.equal(
    BoardRequestSchema.safeParse({
      title: 'Theme',
      thesis: 'A sourced research thesis.',
      preferredValuationMaxUsd: -1,
    }).success,
    false,
  );
  const parsed = BoardAssessmentSchema.parse({
    ...assessment(0),
    nicheReason: 'Specialist workflow',
    tailwind: {
      change: 'A recent sourced change',
      customerNeed: 'A specific new workflow need',
      companyFit: 'A specialist product addresses it',
      weakestLink: 'Paid conversion is unknown',
      evidenceIds: ['valuation-0'],
    },
  });
  assert.equal(parsed.tailwind?.status, 'REASONED HYPOTHESIS');
  assert.equal(
    BoardAssessmentSchema.safeParse({
      ...assessment(0),
      tailwind: { ...parsed.tailwind, evidenceIds: [] },
    }).success,
    false,
  );
});

test('a verified company without a disclosed price stays in the unpriced research pool', async () => {
  const board = createThemeBoard(
    'Niche workflows',
    'A recent market change may create a specialist workflow opportunity.',
    50000000,
  );
  const unpriced = { ...company(1), funding: 'Valuation not disclosed' };
  const identity = {
    ...evidence(1),
    claim: 'TestCo 1 sells a specialist workflow product.',
    summary: 'Official product identity, with no disclosed valuation.',
  };
  await runThemeBoard(
    board,
    () => {},
    undefined,
    async (call) => {
      assert.equal(
        (call.context as { preferredValuationMaxUsd: number }).preferredValuationMaxUsd,
        50000000,
      );
      assert.match(call.task, /50,000,000/);
      if (call.namespace.endsWith('established'))
        return result(output({ companies: [company(0)], evidence: [evidence(0)] }));
      if (call.namespace.endsWith('emerging'))
        return result(output({ companies: [unpriced], evidence: [identity] }));
      if (call.namespace.endsWith('ranking')) return result(output({ shortlist: [assessment(0)] }));
      return result(output());
    },
  );
  assert.equal(board.candidates.length, 1);
  assert.deepEqual(
    board.unpricedCompanies?.map((entry) => entry.id),
    ['company-1'],
  );
  assert.equal(board.unpricedCompanies?.[0].funding, 'Valuation not disclosed');
});

test('SAFE caps, convertible caps and issuer asking prices are not closed priced-round valuations', () => {
  const nominal = {
    ...assessment(0),
    valuation: { ...assessment(0).valuation, amountUsd: 30000000 },
  };
  const caps = [
    'TestCo 0 announced a $30M valuation cap on a SAFE in May 2025.',
    'TestCo 0 raised $400K via a SAFE at a $30M valuation cap in May 2025.',
    'TestCo 0 issued a convertible note with a $30M valuation cap in May 2025.',
    'TestCo 0 advertised an asking valuation of $30M in May 2025.',
  ];
  for (const claim of caps)
    assert.equal(
      assembleCandidates({ evidence: [{ ...evidence(0), claim }] }, [company(0)], [nominal]).length,
      0,
    );
  assert.equal(
    assembleCandidates(
      {
        evidence: [
          {
            ...evidence(0),
            claim: 'TestCo 0 announced a $30M valuation in May 2025.',
            summary: 'The instrument is a SAFE, not a closed priced equity round.',
          },
        ],
      },
      [company(0)],
      [nominal],
    ).length,
    0,
  );
  assert.equal(
    assembleCandidates(
      {
        evidence: [
          {
            ...evidence(0),
            claim: 'TestCo 0 closed a priced Series A at a $30M valuation in May 2025.',
          },
        ],
      },
      [company(0)],
      [nominal],
    ).length,
    1,
  );
  assert.equal(
    assembleCandidates(
      {
        evidence: [
          {
            ...evidence(0),
            claim: 'TestCo 0 closed a priced Series A at a $30M valuation in May 2025.',
            summary: 'The company sells a safe battery platform.',
          },
        ],
      },
      [company(0)],
      [nominal],
    ).length,
    1,
  );
});

test('verified official-domain suffixes preserve financial attribution without fuzzy or spoofed aliases', () => {
  const domainNamed = { ...company(0), name: 'TestCo 0 (testco0.example)' };
  assert.equal(
    assembleCandidates({ evidence: [evidence(0)] }, [domainNamed], [assessment(0)]).length,
    1,
  );
  assert.equal(
    assembleCandidates(
      { evidence: [evidence(0)] },
      [{ ...domainNamed, name: 'TestCo 0 (attacker.example)' }],
      [assessment(0)],
    ).length,
    0,
  );
  assert.equal(
    assembleCandidates(
      { evidence: [evidence(0)] },
      [{ ...domainNamed, name: 'TestCo 0 (unverified brand alias)' }],
      [assessment(0)],
    ).length,
    0,
  );
});

test('identity-only recovery reuses priced leads and resolves five official domains with bounded four-plus-two searches', async () => {
  const board = createThemeBoard(
    'Theme',
    'Previously sourced financing needs official company identity resolution.',
  );
  delete board.preferredValuationMaxUsd;
  board.status = 'partial';
  board.evidence = [0, 1, 2, 3, 4].map(evidence);
  board.agents[0].output = output({ evidence: structuredClone(board.evidence) });
  board.agents[0].status = 'completed';
  board.totalInputTokens = 212000;
  board.totalOutputTokens = 164;
  const calls: string[] = [];
  await resolveThemeBoardIdentities(
    board,
    () => {},
    undefined,
    async (call) => {
      calls.push(call.namespace);
      if (call.namespace === 'theme-identity' || call.namespace === 'theme-identity-extra') {
        const extra = call.namespace.endsWith('extra');
        assert.equal(call.maxSearches, extra ? 2 : 4);
        assert.match(call.task, /Resolve ONLY the official identities/);
        const leads = (call.context as { data: { namedLeads: Array<{ name: string }> } }).data
          .namedLeads;
        assert.equal(leads.length, extra ? 2 : 3);
        const indexes = extra ? [3, 4] : [0, 1, 2];
        return result(
          output({
            companies: indexes.map(company),
            evidence: indexes.map((index) => ({
              ...evidence(index),
              id: `identity-${index}`,
              url: `${company(index).website}/product`,
              claim: `Official product identity for TestCo ${index}`,
              summary: 'Official company product page',
            })),
          }),
        );
      }
      if (call.namespace === 'theme-ranking-gap')
        return result(output({ shortlist: [0, 1, 2, 3, 4].map(assessment) }));
      assert.ok(['theme-valuation-gap', 'theme-bear-gap'].includes(call.namespace));
      return result(output());
    },
  );
  assert.deepEqual(calls, [
    'theme-identity',
    'theme-identity-extra',
    'theme-valuation-gap',
    'theme-bear-gap',
    'theme-ranking-gap',
  ]);
  assert.equal(board.status, 'completed');
  assert.equal(board.candidates.length, 5);
  assert.equal(board.totalInputTokens, 212500);
  assert.equal(board.totalOutputTokens, 264);
  assert.equal(
    board.agents.find((agent) => agent.id === 'scout-established')?.output?.evidence.length,
    5,
  );
});

test('a later two-search identity helper skips the completed first identity pass and limits new adversarial work', async () => {
  const board = createThemeBoard(
    'Theme',
    'Previously sourced financing needs official company identity resolution.',
  );
  delete board.preferredValuationMaxUsd;
  board.status = 'partial';
  board.evidence = [0, 1, 2, 3, 4].map(evidence);
  board.agents.push({
    id: 'identity',
    name: 'Company Identity Resolver',
    status: 'completed',
    inputTokens: 100,
    outputTokens: 20,
    searches: 3,
    output: output({ companies: [0, 1, 2].map(company) }),
  });
  const calls: string[] = [];
  await resolveExtraThemeBoardIdentities(
    board,
    () => {},
    undefined,
    async (call) => {
      calls.push(call.namespace);
      if (call.namespace === 'theme-identity-extra') {
        assert.equal(call.maxSearches, 2);
        return result(output({ companies: [company(3), company(4)] }));
      }
      if (call.namespace === 'theme-valuation-replacement') assert.equal(call.maxSearches, 2);
      if (call.namespace === 'theme-bear-replacement') assert.equal(call.search, false);
      if (call.namespace === 'theme-ranking-replacement')
        return result(output({ shortlist: [0, 1, 2, 3, 4].map(assessment) }));
      return result(output());
    },
  );
  assert.deepEqual(calls, [
    'theme-identity-extra',
    'theme-valuation-replacement',
    'theme-bear-replacement',
    'theme-ranking-replacement',
  ]);
  assert.equal(board.candidates.length, 5);
});
