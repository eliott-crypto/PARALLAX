import type { AgentId, AgentOutput, Company, Evidence, Investigation, RadarData } from './types';

// Editorial research fixture. These are role-shaped findings, never a recorded model run.
// Retrieval time records the manual source review, not a synthetic agent execution.
const retrievedAt = '2026-10-15T11:17:52.000Z';
const source = (
  id: string,
  claim: string,
  url: string,
  title: string,
  publisher: string,
  publishedAt: string | null,
  summary: string,
  type: Evidence['type'],
  company?: string,
): Evidence => ({
  id,
  claim,
  url,
  title,
  publisher,
  publishedAt,
  retrievedAt,
  summary,
  type,
  status: 'SUPPORTED',
  ...(company ? { company } : {}),
});

export const sampleEvidence: Evidence[] = [
  source(
    'ev-inference',
    'A historical benchmark-equivalent inference price declined more than 280-fold.',
    'https://hai.stanford.edu/news/ai-index-2025-state-of-ai-in-10-charts',
    'AI Index 2025: State of AI in 10 Charts',
    'Stanford HAI',
    '2025-04-07',
    'The reported comparison spans November 2022 to October 2024 and uses GPT-3.5-equivalent MMLU performance. It does not measure end-to-end agent task cost.',
    'RESEARCH_PUBLICATION',
  ),
  source(
    'ev-browserbase-docs',
    'Browserbase offers hosted browser sessions and agent infrastructure.',
    'https://docs.browserbase.com/welcome/introduction',
    'Introducing Browserbase',
    'Browserbase',
    null,
    'Documentation describes browser APIs, session observation, Stagehand and integrations with Playwright, Puppeteer and Selenium. Capability descriptions are first-party claims, not comparative benchmarks.',
    'FIRST_PARTY_COMPANY_CLAIM',
    'Browserbase',
  ),
  source(
    'ev-browserbase-series-b',
    'Browserbase announced a $40 million Series B and expanded its automation products.',
    'https://www.browserbase.com/blog/series-b-and-beyond',
    'Building the future of web automation',
    'Browserbase',
    '2025-06-18',
    'The company announcement names Notable Capital as lead investor and introduces Director and Stagehand for Python. Funding is historical; no current valuation or revenue is inferred.',
    'FIRST_PARTY_COMPANY_CLAIM',
    'Browserbase',
  ),
  source(
    'ev-founder',
    'Paul Klein IV publicly identifies as Browserbase founder and CEO.',
    'https://klein.dev/',
    'Paul Klein IV',
    'Paul Klein IV',
    null,
    'His professional website links Browserbase and Stagehand. The identity is corroborated by the investor source; the page does not establish product performance or investment returns.',
    'PUBLIC_PROFESSIONAL_RECORD',
    'Browserbase',
  ),
  source(
    'ev-notable',
    'Notable identifies Paul Klein IV as Browserbase founder and says it led the Series B.',
    'https://www.notablecap.com/blog/why-we-invested-in-browserbase',
    'Building the Browser Infrastructure for AI Agents with the Founder of Browserbase',
    'Notable Capital',
    '2025-06-17',
    'An investor account independently corroborates professional identity and the financing relationship. It is an interested-party source; its product enthusiasm is not neutral validation.',
    'PUBLIC_PROFESSIONAL_RECORD',
    'Browserbase',
  ),
  source(
    'ev-browserless',
    'Browserless sells browser infrastructure for AI agents.',
    'https://www.browserless.io/',
    'The web layer your agents run on',
    'Browserless',
    null,
    'The product site advertises persistent authenticated profiles, automation APIs and agent tools. This establishes a competing offering, not equal reliability or market share.',
    'FIRST_PARTY_COMPANY_CLAIM',
    'Browserless',
  ),
  source(
    'ev-steel',
    'Steel offers hosted and self-hostable browser infrastructure.',
    'https://steel.dev/',
    'Open-source Browser Infrastructure for AI Agents',
    'Steel',
    null,
    'Steel describes cloud sessions, observability and an open-source server with self-hosting. Its existence challenges exclusivity; no performance claims were independently tested.',
    'FIRST_PARTY_COMPANY_CLAIM',
    'Steel',
  ),
  source(
    'ev-ssdf',
    'NIST SSDF connects secure development practices with supplier acquisition discussions.',
    'https://csrc.nist.gov/pubs/sp/800/218/final',
    'Secure Software Development Framework, Version 1.1',
    'NIST',
    '2022-02-03',
    'The framework recommends practices to mitigate software vulnerabilities and gives purchasers a vocabulary for supplier discussions. This is foundational guidance, not a new legal mandate or spending forecast.',
    'OFFICIAL_DOCUMENT',
  ),
  source(
    'ev-chainguard',
    'Chainguard markets continuously rebuilt container images with provenance.',
    'https://www.chainguard.dev/containers',
    'Chainguard Containers',
    'Chainguard',
    null,
    'The product page describes container rebuilds, signed SBOMs and remediation service levels. Its zero-CVE wording means no known CVEs at publication, not an absence of all vulnerabilities.',
    'FIRST_PARTY_COMPANY_CLAIM',
    'Chainguard',
  ),
  source(
    'ev-energy',
    'LBNL models substantial growth in U.S. data-center electricity demand.',
    'https://www.energy.gov/documents/united-states-data-center-energy-usage-report-2025-update',
    'United States Data Center Energy Usage Report: 2025 Update',
    'Lawrence Berkeley National Laboratory / U.S. DOE',
    '2026-06',
    'Published June 2026: estimated 2024 consumption is 192 TWh; its reference case projects 464 TWh in 2028. Future values are scenario outputs sensitive to shipment and utilization assumptions, not observed demand.',
    'RESEARCH_PUBLICATION',
  ),
  source(
    'ev-fervo',
    'Fervo reports commercial operation of the first Cape Station GeoBlock.',
    'https://fervoenergy.com/fervo-energy-declares-commercial-operation-at-cape-station-ahead-of-schedule-leading-the-race-for-next-generation-geothermal-energy/',
    'Fervo Energy Declares Commercial Operation at Cape Station',
    'Fervo Energy',
    '2026-10-01',
    'Fervo reports a first GeoBlock reaching commercial operation and 33 MW net output. Remaining project stages are future plans; this review did not independently audit operating results or economics.',
    'FIRST_PARTY_COMPANY_CLAIM',
    'Fervo Energy',
  ),
];

export const browserbase: Company = {
  id: 'browserbase',
  name: 'Browserbase',
  website: 'https://www.browserbase.com',
  category: 'AI infrastructure',
  description:
    'Cloud browser infrastructure and developer tooling for agents that interact with the web.',
  alignment:
    'Potential execution layer as cheaper reasoning makes more browser tasks economically testable.',
  strengths: [
    'Hosted browser platform',
    'Stagehand developer distribution',
    'Publicly corroborated founder identity',
  ],
  uncertainty: 'Retention, gross margin, task reliability and switching costs remain unverified.',
  confidence: 'MEDIUM',
  evidenceIds: ['ev-browserbase-docs', 'ev-browserbase-series-b', 'ev-founder', 'ev-notable'],
  funding: '$40M Series B announced June 2025 (historical company claim)',
};

const browserless: Company = {
  id: 'browserless',
  name: 'Browserless',
  website: 'https://www.browserless.io',
  category: 'AI infrastructure',
  description: 'Managed browser automation and agent tooling.',
  alignment: 'Alternative browser execution provider.',
  strengths: ['Persistent profile offering', 'Browser automation tooling'],
  uncertainty: 'No comparative performance or commercial diligence conducted.',
  confidence: 'MEDIUM',
  evidenceIds: ['ev-browserless'],
};
const steel: Company = {
  id: 'steel',
  name: 'Steel',
  website: 'https://steel.dev',
  category: 'AI infrastructure',
  description: 'Hosted and open-source browser infrastructure for agents.',
  alignment: 'Managed service and self-hosting alternative.',
  strengths: ['Open-source server', 'Session observability offering'],
  uncertainty: 'Commercial traction and operating economics unverified.',
  confidence: 'MEDIUM',
  evidenceIds: ['ev-steel'],
};

export const sampleRadar: RadarData = {
  mode: 'sample',
  updatedAt: retrievedAt,
  warning:
    'Curated research sample, manually source-checked on 15 October 2026. This is not a live scan or a recorded Claude investigation. Publication dates vary; causal effects and company upside are hypotheses.',
  evidence: sampleEvidence,
  signals: [
    {
      id: 'inference-execution',
      title: 'When reasoning gets cheaper, execution becomes the bottleneck.',
      sector: 'AI infrastructure',
      date: '2025-04-07',
      confidence: 'MEDIUM',
      summary:
        'A historical collapse in benchmark-equivalent inference pricing expands the set of workflows worth testing. The next constraint may be reliable action across the web.',
      whyNow:
        'The cost trend is documented; production browser infrastructure is a visible category. This sample tests the second-order opportunity rather than assuming demand.',
      evidenceIds: ['ev-inference', 'ev-browserbase-docs', 'ev-browserless', 'ev-steel'],
      sourceCount: 4,
      causalChain: [
        {
          label: 'Benchmark-equivalent inference became cheaper in the measured 2022–24 period',
          status: 'VERIFIED',
          evidenceIds: ['ev-inference'],
        },
        {
          label: 'More multi-step workflows may become economically testable',
          status: 'REASONED HYPOTHESIS',
          evidenceIds: ['ev-inference'],
        },
        {
          label: 'Reliable browser execution may capture incremental infrastructure spend',
          status: 'REASONED HYPOTHESIS',
          evidenceIds: ['ev-browserbase-docs', 'ev-browserless', 'ev-steel'],
        },
        {
          label: 'Browserbase may retain value through tooling and operational reliability',
          status: 'SPECULATIVE',
          evidenceIds: ['ev-browserbase-docs'],
        },
      ],
      companies: [browserbase, browserless, steel],
      uncertainty:
        'Lower token prices do not prove lower cost per successful task. Browser duration, retries, authentication and competing providers can absorb the benefit.',
    },
    {
      id: 'secure-software',
      title: 'Security shifts from finding flaws to shipping trusted artifacts.',
      sector: 'Cybersecurity',
      date: '2022-02-03',
      confidence: 'MEDIUM',
      summary:
        'Secure-development guidance gives buyers a language for supplier scrutiny. Rebuilt, signed software artifacts offer a concrete response to that structural need.',
      whyNow:
        'This is a structural research theme anchored in a 2022 framework and a currently reviewed product offering, not a breaking regulatory announcement.',
      evidenceIds: ['ev-ssdf', 'ev-chainguard'],
      sourceCount: 2,
      causalChain: [
        {
          label: 'NIST recommends secure development and supplier communication',
          status: 'VERIFIED',
          evidenceIds: ['ev-ssdf'],
        },
        {
          label: 'Buyers may demand stronger provenance and remediation commitments',
          status: 'REASONED HYPOTHESIS',
          evidenceIds: ['ev-ssdf'],
        },
        {
          label: 'Hardened artifact providers may reduce customer security workload',
          status: 'REASONED HYPOTHESIS',
          evidenceIds: ['ev-chainguard'],
        },
      ],
      companies: [
        {
          id: 'chainguard',
          name: 'Chainguard',
          website: 'https://www.chainguard.dev',
          category: 'Cybersecurity',
          description: 'Rebuilt software artifacts with provenance and vulnerability remediation.',
          alignment: 'A possible supplier of trusted deployment inputs.',
          strengths: ['Container offering', 'Signed artifact provenance'],
          uncertainty:
            'Customer savings and willingness to pay were not independently verified. Zero known CVEs is not zero risk.',
          confidence: 'MEDIUM',
          evidenceIds: ['ev-chainguard'],
        },
      ],
      uncertainty:
        'Guidance does not establish mandatory adoption, buyer budgets or a defensible company moat.',
    },
    {
      id: 'firm-power',
      title: 'AI demand puts a premium on power that is always available.',
      sector: 'Energy',
      date: '2026-10-01',
      confidence: 'MEDIUM',
      summary:
        'LBNL forecasts rising data-center electricity demand. Fervo now reports a first commercial Cape Station GeoBlock, giving the firm-power thesis an operating milestone to examine.',
      whyNow:
        'Fervo’s October 2026 company announcement is a recent catalyst; LBNL’s June 2026 update supplies a separate demand scenario.',
      evidenceIds: ['ev-energy', 'ev-fervo'],
      sourceCount: 2,
      causalChain: [
        {
          label: 'LBNL’s reference case projects rising data-center electricity use',
          status: 'VERIFIED',
          evidenceIds: ['ev-energy'],
        },
        {
          label: 'Demand growth may increase appetite for new firm supply',
          status: 'REASONED HYPOTHESIS',
          evidenceIds: ['ev-energy'],
        },
        {
          label: 'Enhanced geothermal could capture part of that demand',
          status: 'REASONED HYPOTHESIS',
          evidenceIds: ['ev-fervo'],
        },
      ],
      companies: [
        {
          id: 'fervo',
          name: 'Fervo Energy',
          website: 'https://fervoenergy.com',
          category: 'Energy',
          description: 'Developer of enhanced geothermal power projects.',
          alignment:
            'Potential provider of round-the-clock power for a growing electricity system.',
          strengths: ['Reported commercial-operation milestone', 'Enhanced geothermal development'],
          uncertainty:
            'Plant performance is first-party reported. Project economics, financing and repeatability need diligence.',
          confidence: 'MEDIUM',
          evidenceIds: ['ev-fervo'],
        },
      ],
      uncertainty:
        'Demand forecasts are scenarios. Site-specific permitting, interconnection, drilling and capital costs can dominate outcomes.',
    },
  ],
};

const output = (
  summary: string,
  findings: AgentOutput['findings'],
  extra: Partial<AgentOutput> = {},
): AgentOutput => ({
  summary,
  findings,
  evidence: [],
  questions: [],
  confidence: 'MEDIUM',
  ...extra,
});
const findings: Record<AgentId, AgentOutput> = {
  scout: output(
    'A real cost signal; an unproven execution opportunity.',
    [
      {
        title: 'The historical input cost changed',
        detail:
          'Stanford documents a benchmark-normalized inference price decline. This is evidence of cheaper reasoning, not a forecast of agent revenue.',
        evidenceIds: ['ev-inference'],
        kind: 'FACT',
      },
      {
        title: 'Success is the missing denominator',
        detail:
          'Measure spend per completed workflow, including browser time, retries and human intervention.',
        evidenceIds: [],
        kind: 'HYPOTHESIS',
      },
    ],
    { questions: ['Which workflows become economical after total execution cost is included?'] },
  ),
  causal: output(
    'Cheaper reasoning may move the scarce resource toward reliable execution.',
    [
      {
        title: 'A conditional second-order effect',
        detail:
          'If reasoning cost falls and workflows work reliably, more actions could reach browser infrastructure. Neither condition proves durable margins.',
        evidenceIds: ['ev-inference', 'ev-browserbase-docs'],
        kind: 'HYPOTHESIS',
      },
      {
        title: 'Falsification test',
        detail:
          'If API-native workflows or self-hosted browsers offer better cost per successful task, the proposed infrastructure bottleneck weakens.',
        evidenceIds: ['ev-steel'],
        kind: 'HYPOTHESIS',
      },
    ],
    {
      causalChain: sampleRadar.signals[0].causalChain,
      questions: [
        'What share of target tasks genuinely requires a browser rather than a direct API?',
      ],
    },
  ),
  hunter: output(
    'Browserbase is a relevant candidate, alongside real substitutes.',
    [
      {
        title: 'Product fit is observable',
        detail: 'Public documentation places Browserbase directly in the browser execution layer.',
        evidenceIds: ['ev-browserbase-docs'],
        kind: 'COMPANY CLAIM',
      },
      {
        title: 'Funding is context, not product-market fit',
        detail:
          'The financing announcement supports a historical funding claim; it does not establish retention or customer economics.',
        evidenceIds: ['ev-browserbase-series-b'],
        kind: 'COMPANY CLAIM',
      },
    ],
    {
      companies: [browserbase, browserless, steel],
      questions: ['Obtain cohort retention, usage concentration and revenue quality data.'],
    },
  ),
  founder: output(
    'Professional identity is corroborated; execution quality still needs diligence.',
    [
      {
        title: 'Paul Klein IV — founder and CEO',
        detail:
          'The professional website identifies the role; Notable’s article connects the same person to Browserbase and its financing.',
        evidenceIds: ['ev-founder', 'ev-notable'],
        kind: 'FACT',
      },
      {
        title: 'Relevant builder record',
        detail:
          'The public professional site links both Browserbase and Stagehand. That supports a product association, not a judgment about character or future results.',
        evidenceIds: ['ev-founder'],
        kind: 'FACT',
      },
      {
        title: 'Unverified operating references',
        detail:
          'No customer reference calls, employment checks or private founder diligence were performed for this editorial sample.',
        evidenceIds: [],
        kind: 'UNKNOWN',
      },
    ],
    {
      questions: [
        'Request consented professional references and evidence of hiring and operational execution.',
      ],
    },
  ),
  competitive: output(
    'The category is real. Exclusive ownership of it is not.',
    [
      {
        title: 'Managed alternative',
        detail: 'Browserless markets agent-oriented browser tooling and persistent profiles.',
        evidenceIds: ['ev-browserless'],
        kind: 'COMPANY CLAIM',
      },
      {
        title: 'Self-hosting alternative',
        detail:
          'Steel offers a managed service and an open-source browser server. Buyers have options beyond Browserbase.',
        evidenceIds: ['ev-steel'],
        kind: 'COMPANY CLAIM',
      },
      {
        title: 'Moat requires measurement',
        detail:
          'Compare authenticated workflow completion, replay/debugging quality, total cost and migration effort on the same workload.',
        evidenceIds: ['ev-browserbase-docs', 'ev-browserless', 'ev-steel'],
        kind: 'HYPOTHESIS',
      },
    ],
    { questions: ['Why do customers stay once browser APIs become easier to substitute?'] },
  ),
  bull: output(
    'The attractive thesis is a trusted execution layer, not browser capacity alone.',
    [
      {
        title: 'Developer tooling can influence adoption',
        detail:
          'A platform paired with Stagehand could become a convenient default for teams deploying browser workflows. Distribution benefits remain a hypothesis.',
        evidenceIds: ['ev-browserbase-docs'],
        kind: 'HYPOTHESIS',
      },
      {
        title: 'Reliability could earn a premium',
        detail:
          'If the platform lowers failure recovery and support effort, customers may pay above raw browser-compute cost.',
        evidenceIds: [],
        kind: 'HYPOTHESIS',
      },
    ],
    {
      disputedClaim:
        'Browserbase is the inevitable, uniquely defensible winner of cheaper agent reasoning.',
      questions: [
        'Can workflow-level performance and retention demonstrate a premium over substitutes?',
      ],
    },
  ),
  bear: output(
    'Category growth can coexist with weak supplier economics.',
    [
      {
        title: 'The monopoly premise fails',
        detail:
          'Browserless and Steel offer directly relevant alternatives. A browser infrastructure opportunity does not establish unique defensibility.',
        evidenceIds: ['ev-browserless', 'ev-steel'],
        kind: 'FACT',
      },
      {
        title: 'Token savings may disappear in retries',
        detail:
          'Cheaper inference can enable more attempts without reducing the cost of a successful task. Browser compute and human escalation remain separate costs.',
        evidenceIds: ['ev-inference'],
        kind: 'HYPOTHESIS',
      },
      {
        title: 'No margin evidence',
        detail:
          'The reviewed public sources do not establish gross margin, net retention, customer concentration or switching cost.',
        evidenceIds: [],
        kind: 'UNKNOWN',
      },
    ],
    {
      disputedClaim:
        'Browserbase is the inevitable, uniquely defensible winner of cheaper agent reasoning.',
      questions: ['Does the premium persist after retries, proxy spend and support cost?'],
    },
  ),
  verifier: output(
    'The broad category thesis survives. The unique-winner claim does not.',
    [
      {
        title: 'Historical inference trend: supported',
        detail:
          'The Stanford source supports its stated benchmark comparison and dates. Extrapolating it to present-day task economics is unverified.',
        evidenceIds: ['ev-inference'],
        kind: 'FACT',
      },
      {
        title: 'Exclusivity: contradicted',
        detail:
          'Current competitor product pages establish alternative browser infrastructure offerings. Their relative quality is unresolved.',
        evidenceIds: ['ev-browserless', 'ev-steel'],
        kind: 'FACT',
      },
      {
        title: 'Founder identity: corroborated',
        detail:
          'Two public professional sources agree on Paul Klein IV’s Browserbase association; investor material carries an economic interest.',
        evidenceIds: ['ev-founder', 'ev-notable'],
        kind: 'FACT',
      },
    ],
    {
      verification: 'PARTIALLY SUPPORTED',
      disputedClaim:
        'Browserbase is the inevitable, uniquely defensible winner of cheaper agent reasoning.',
      revision:
        'Replace the inevitable-winner thesis with: Browserbase is a relevant research candidate in a competitive execution category. Prioritise only if matched workload tests and consented commercial diligence demonstrate durable advantage.',
      questions: [
        'Run a matched workflow benchmark.',
        'Verify retention and gross margin before upgrading conviction.',
      ],
    },
  ),
  committee: output(
    'MONITOR — upgrade only when the execution premium is demonstrated.',
    [
      {
        title: 'What is established',
        detail:
          'The cost trend, product category and founder identity have traceable public support. None proves investment upside.',
        evidenceIds: ['ev-inference', 'ev-browserbase-docs', 'ev-founder', 'ev-notable'],
        kind: 'FACT',
      },
      {
        title: 'What changes the decision',
        detail:
          'Move to PRIORITISE RESEARCH if a controlled benchmark shows stronger completion economics and customer diligence supports retention and margins.',
        evidenceIds: [],
        kind: 'HYPOTHESIS',
      },
      {
        title: 'What would weaken the thesis',
        detail:
          'Equivalent outcomes from interchangeable providers or API-native workflows would reduce the case for a durable infrastructure premium.',
        evidenceIds: ['ev-browserless', 'ev-steel'],
        kind: 'HYPOTHESIS',
      },
    ],
    {
      decision: 'MONITOR',
      confidence: 'MEDIUM',
      revision:
        'The bear objection narrows the thesis from category inevitability to a testable company-specific execution advantage.',
      questions: [
        'Benchmark the same permissioned workflows across three providers.',
        'Request gross margin, paid retention and concentration data.',
        'Reassess after independent customer references.',
      ],
    },
  ),
};

export const sampleInvestigation: Investigation = {
  id: 'sample-browserbase',
  title: 'Browserbase: who captures the value of cheaper reasoning?',
  query:
    'Does falling inference cost create a defensible opportunity for Browserbase, or does browser execution become a commodity?',
  signalId: 'inference-execution',
  company: browserbase,
  mode: 'sample',
  status: 'completed',
  createdAt: retrievedAt,
  completedAt: retrievedAt,
  agents: (Object.keys(findings) as AgentId[]).map((id) => ({
    id,
    status: 'completed',
    output: findings[id],
  })),
  // Empty by design: no Claude calls, tool execution, timings or tokens are fabricated.
  events: [],
  evidence: sampleEvidence.filter((e) =>
    [
      'ev-inference',
      'ev-browserbase-docs',
      'ev-browserbase-series-b',
      'ev-founder',
      'ev-notable',
      'ev-browserless',
      'ev-steel',
    ].includes(e.id),
  ),
  decision: 'MONITOR',
  confidence: 'MEDIUM',
  watched: false,
  totalInputTokens: 0,
  totalOutputTokens: 0,
};
