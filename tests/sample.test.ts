import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AgentIds,
  AgentOutputSchema,
  CompanySchema,
  EvidenceSchema,
  SignalSchema,
  type Company,
  type Evidence,
} from '../shared/types';
import { sampleEvidence, sampleInvestigation, sampleRadar } from '../shared/sample';

function evidenceIndex(records: Evidence[]) {
  const index = new Map<string, Evidence>();
  for (const record of records) {
    EvidenceSchema.parse(record);
    assert.ok(!index.has(record.id), `Duplicate evidence ID: ${record.id}`);
    assert.ok(
      Number.isFinite(Date.parse(record.retrievedAt)),
      `Invalid retrieval timestamp: ${record.id}`,
    );
    assert.ok(record.summary.trim(), `Missing source scope or limitation: ${record.id}`);
    index.set(record.id, record);
  }
  return index;
}

function references(ids: string[], evidence: Map<string, Evidence>, context: string) {
  assert.equal(new Set(ids).size, ids.length, `Duplicate citations in ${context}`);
  for (const id of ids) assert.ok(evidence.has(id), `Missing citation ${id} in ${context}`);
}

function companyReferences(company: Company, evidence: Map<string, Evidence>, context: string) {
  CompanySchema.parse(company);
  assert.ok(company.id.trim());
  assert.ok(company.name.trim());
  assert.ok(company.evidenceIds.length > 0, `Company lacks evidence in ${context}`);
  references(company.evidenceIds, evidence, `${context}: ${company.name}`);
}

test('curated radar records validate and source counts represent distinct cited URLs', () => {
  const evidence = evidenceIndex(sampleRadar.evidence);
  assert.deepEqual(sampleRadar.evidence, sampleEvidence);
  assert.ok(sampleRadar.signals.length >= 3);
  assert.equal(
    new Set(sampleRadar.signals.map((signal) => signal.id)).size,
    sampleRadar.signals.length,
  );
  const identities = new Map<string, string>();
  for (const signal of sampleRadar.signals) {
    SignalSchema.parse(signal);
    references(signal.evidenceIds, evidence, signal.title);
    const distinctUrls = new Set(signal.evidenceIds.map((id) => evidence.get(id)!.url));
    assert.equal(signal.sourceCount, distinctUrls.size, `Inflated source count: ${signal.id}`);
    assert.equal(
      new Set(signal.companies.map((company) => company.id)).size,
      signal.companies.length,
    );
    for (const company of signal.companies) {
      companyReferences(company, evidence, signal.title);
      const identity = `${company.name}|${company.website}`;
      assert.ok(
        !identities.has(company.id) || identities.get(company.id) === identity,
        `Conflicting company identity: ${company.id}`,
      );
      identities.set(company.id, identity);
    }
    for (const link of signal.causalChain) references(link.evidenceIds, evidence, link.label);
    assert.ok(signal.uncertainty.trim(), `Missing uncertainty: ${signal.id}`);
    assert.ok(
      signal.causalChain.some((link) => link.status !== 'VERIFIED'),
      `Causal inference not distinguished: ${signal.id}`,
    );
  }
});

test('all nine editorial perspectives preserve citations and adversarial revision', () => {
  const investigation = sampleInvestigation;
  const evidence = evidenceIndex(investigation.evidence);
  assert.deepEqual(
    investigation.agents.map((agent) => agent.id),
    [...AgentIds],
  );
  assert.ok(investigation.company);
  companyReferences(investigation.company, evidence, investigation.title);
  assert.ok(sampleRadar.signals.some((signal) => signal.id === investigation.signalId));
  for (const agent of investigation.agents) {
    assert.equal(agent.status, 'completed');
    assert.ok(agent.output, `Missing ${agent.id} perspective`);
    const output = AgentOutputSchema.parse(agent.output);
    for (const finding of output.findings) {
      references(finding.evidenceIds, evidence, `${agent.id}: ${finding.title}`);
      if (finding.kind === 'FACT' || finding.kind === 'COMPANY CLAIM') {
        assert.ok(
          finding.evidenceIds.length > 0,
          `Uncited factual finding: ${agent.id}: ${finding.title}`,
        );
      }
    }
    for (const source of output.evidence) {
      EvidenceSchema.parse(source);
      assert.deepEqual(source, evidence.get(source.id));
    }
    for (const company of output.companies ?? []) companyReferences(company, evidence, agent.id);
    for (const link of output.causalChain ?? []) references(link.evidenceIds, evidence, link.label);
  }
  const bull = investigation.agents.find((agent) => agent.id === 'bull')!.output!;
  const bear = investigation.agents.find((agent) => agent.id === 'bear')!.output!;
  const verifier = investigation.agents.find((agent) => agent.id === 'verifier')!.output!;
  const committee = investigation.agents.find((agent) => agent.id === 'committee')!.output!;
  assert.ok(bull.disputedClaim);
  assert.equal(bear.disputedClaim, bull.disputedClaim);
  assert.equal(verifier.disputedClaim, bear.disputedClaim);
  assert.equal(verifier.verification, 'PARTIALLY SUPPORTED');
  assert.ok(verifier.revision);
  assert.equal(committee.decision, investigation.decision);
  assert.ok(committee.questions.length > 0);
});

test('curated data cannot present fabricated live execution or usage', () => {
  assert.equal(sampleRadar.mode, 'sample');
  assert.match(sampleRadar.warning ?? '', /not a live scan or a recorded Claude investigation/i);
  assert.equal(sampleInvestigation.mode, 'sample');
  assert.equal(sampleInvestigation.model, undefined);
  assert.deepEqual(sampleInvestigation.events, []);
  assert.equal(sampleInvestigation.totalInputTokens, 0);
  assert.equal(sampleInvestigation.totalOutputTokens, 0);
  for (const agent of sampleInvestigation.agents) {
    assert.equal(agent.startedAt, undefined);
    assert.equal(agent.completedAt, undefined);
    assert.equal(agent.inputTokens, undefined);
    assert.equal(agent.outputTokens, undefined);
    assert.equal(agent.searches, undefined);
  }
});
