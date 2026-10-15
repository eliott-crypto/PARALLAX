import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { loadRecordings, validateRecording } from '../server/recordings';
import { createApp } from '../server/app';
import { ResearchStore } from '../server/store';

test('bundled replay is a completed actual execution with corrections and model provenance', () => {
  const records = loadRecordings();
  assert.ok(records.length >= 1);
  for (const run of records) {
    validateRecording(run);
    assert.equal(run.mode, 'recorded');
    assert.equal(run.status, 'completed');
    assert.ok(run.totalInputTokens > 0);
    assert.equal(
      run.events.filter((event) => event.agentId === 'verifier' && event.type === 'agent_started')
        .length,
      2,
    );
    assert.ok(run.events.some((event) => event.type === 'evidence_corrected'));
    assert.ok(run.reviewNotes?.length);
    const committee = run.agents.find((agent) => agent.id === 'committee')!;
    assert.equal(committee.model, 'claude-opus-5-5');
    assert.doesNotMatch(committee.output!.summary, /5\.78|68[x×]|empirically confirmed/i);
    assert.match(committee.output!.summary, /unknown|unproven/i);
  }
});

test('recording validation rejects samples, unfinished runs, and zero provider usage', () => {
  const original = loadRecordings()[0];
  for (const change of [{ mode: 'sample' }, { status: 'partial' }, { totalInputTokens: 0 }])
    assert.throws(() => validateRecording({ ...structuredClone(original), ...change }));
});

test('a fresh checkout serves the real replay and export without an API key or prior local state', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'parallax-replay-'));
  const instance = createApp({ store: new ResearchStore(directory), configured: () => false });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const runs = await (await fetch(`${base}/api/investigations`)).json();
    const replay = runs.find((run: { mode: string }) => run.mode === 'recorded');
    assert.ok(replay);
    const detail = await (await fetch(`${base}/api/investigations/${replay.id}`)).json();
    assert.equal(detail.status, 'completed');
    assert.equal(detail.decision, 'MONITOR');
    const report = await (await fetch(`${base}/api/investigations/${replay.id}/export`)).text();
    assert.match(report, /Verification correction:/);
    assert.match(report, /Source-quality review/);
  } finally {
    instance.shutdown();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
