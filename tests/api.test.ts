import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app';
import { ResearchStore } from '../server/store';
import { sampleInvestigation } from '../shared/sample';
import { renderReport } from '../server/report';

async function fixture(configured = false) {
  const directory = mkdtempSync(join(tmpdir(), 'parallax-api-'));
  const instance = createApp({
    store: new ResearchStore(directory),
    recordings: [],
    configured: () => configured,
    runner: async (run, onUpdate) => {
      run.status = 'completed';
      run.confidence = 'MEDIUM';
      run.decision = 'MONITOR';
      const event = {
        id: 'test',
        investigationId: run.id,
        timestamp: new Date().toISOString(),
        type: 'report.completed',
        message: 'Controlled integration test',
      };
      run.events.push(event);
      onUpdate(event);
    },
  });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    instance,
    async close() {
      instance.shutdown();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('missing API key has explicit error; sample remains browsable', async () => {
  const f = await fixture();
  try {
    const status = await (await fetch(`${f.base}/api/status`)).json();
    assert.equal(status.configured, false);
    assert.ok(!JSON.stringify(status).includes('sk-ant-'));
    const blocked = await fetch(`${f.base}/api/investigations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Browserbase' }),
    });
    assert.equal(blocked.status, 503);
    assert.equal((await blocked.json()).code, 'API_KEY_MISSING');
    const sample = await (await fetch(`${f.base}/api/sample`)).json();
    assert.equal(sample.mode, 'sample');
    assert.ok(sample.evidence.length > 0);
    const unknown = await fetch(`${f.base}/api/unknown`);
    assert.equal(unknown.status, 404);
  } finally {
    await f.close();
  }
});

test('validated API starts, persists and exports an investigation', async () => {
  const f = await fixture(true);
  try {
    const invalid = await fetch(`${f.base}/api/investigations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'x' }),
    });
    assert.equal(invalid.status, 400);
    const hostile = await fetch(`${f.base}/api/investigations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.example' },
      body: JSON.stringify({ query: 'Browserbase' }),
    });
    assert.equal(hostile.status, 403);
    const response = await fetch(`${f.base}/api/investigations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Browserbase' }),
    });
    assert.equal(response.status, 202);
    const run = await response.json();
    const saved = await (await fetch(`${f.base}/api/investigations/${run.id}`)).json();
    assert.equal(saved.status, 'completed');
    assert.equal(saved.decision, 'MONITOR');
    const watched = await fetch(`${f.base}/api/investigations/${run.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watched: true }),
    });
    assert.equal((await watched.json()).watched, true);
    const report = await fetch(`${f.base}/api/investigations/${run.id}/export`);
    assert.match(await report.text(), /Decision: MONITOR/);
    assert.match(report.headers.get('Content-Type')!, /text\/markdown/);
    const list = await (await fetch(`${f.base}/api/investigations`)).json();
    assert.equal(list.length, 1);
  } finally {
    await f.close();
  }
});

test('sample export labels editorial research and preserves citations', () => {
  const report = renderReport(sampleInvestigation);
  assert.match(report, /not a Claude execution/);
  assert.match(report, /https:\/\//);
  assert.match(report, /Sources/);
});

test('SSE exposes initial state and cancellation preserves a completed stage', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'parallax-stream-'));
  const instance = createApp({
    store: new ResearchStore(directory),
    recordings: [],
    configured: () => true,
    runner: async (run, onUpdate, signal) => {
      run.agents[0].status = 'completed';
      run.agents[1].status = 'running';
      const event = {
        id: 'stage',
        investigationId: run.id,
        timestamp: new Date().toISOString(),
        type: 'agent.completed',
        message: 'Scout completed controlled fixture',
      };
      run.events.push(event);
      onUpdate(event);
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true });
      });
    },
  });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const run = await (
      await fetch(`${base}/api/investigations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'Test public company' }),
      })
    ).json();
    const stream = await fetch(`${base}/api/investigations/${run.id}/events`);
    assert.match(stream.headers.get('Content-Type')!, /text\/event-stream/);
    reader = stream.body!.getReader();
    const first = await reader.read();
    const snapshot = JSON.parse(
      new TextDecoder().decode(first.value).split('data: ')[1].split('\n\n')[0],
    );
    assert.equal(snapshot.id, run.id);
    assert.equal(snapshot.agents[0].status, 'completed');
    const cancelled = await (
      await fetch(`${base}/api/investigations/${run.id}/cancel`, { method: 'POST' })
    ).json();
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.agents[0].status, 'completed');
    assert.equal(cancelled.agents[1].status, 'failed');
  } finally {
    await reader?.cancel();
    instance.shutdown();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('sample watch state survives reload and different localhost origins are rejected', async () => {
  const f = await fixture(true);
  try {
    const watched = await fetch(`${f.base}/api/investigations/${sampleInvestigation.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watched: true }),
    });
    assert.equal(watched.status, 200);
    const sample = await (await fetch(`${f.base}/api/sample`)).json();
    assert.equal(sample.watched, true);
    const crossPort = await fetch(`${f.base}/api/investigations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:1' },
      body: JSON.stringify({ query: 'Browserbase' }),
    });
    assert.equal(crossPort.status, 403);
  } finally {
    await f.close();
  }
});

test('assessment recovery only runs the remaining committee step and rejects missing research', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'parallax-finish-'));
  let calls = 0;
  const instance = createApp({
    store: new ResearchStore(directory),
    recordings: [],
    configured: () => true,
    finisher: async (run, onUpdate) => {
      calls++;
      run.status = 'completed';
      run.decision = 'MONITOR';
      run.agents.find((agent) => agent.id === 'committee')!.status = 'completed';
      const event = {
        id: 'finish',
        investigationId: run.id,
        timestamp: new Date().toISOString(),
        type: 'investigation_completed',
        message: 'Controlled committee recovery',
      };
      run.events.push(event);
      onUpdate(event);
    },
  });
  const run = structuredClone(sampleInvestigation);
  run.id = 'finishable';
  run.mode = 'live';
  run.status = 'partial';
  run.agents.find((agent) => agent.id === 'committee')!.status = 'failed';
  instance.store.save(run);
  const broken = structuredClone(run);
  broken.id = 'missing-research';
  broken.agents.find((agent) => agent.id === 'founder')!.status = 'failed';
  instance.store.save(broken);
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const denied = await fetch(`${base}/api/investigations/missing-research/complete`, {
      method: 'POST',
    });
    assert.equal(denied.status, 409);
    assert.equal(calls, 0);
    const before = JSON.stringify(run.agents.find((agent) => agent.id === 'founder')!.output);
    const response = await fetch(`${base}/api/investigations/finishable/complete`, {
      method: 'POST',
    });
    assert.equal(response.status, 202);
    assert.equal((await response.json()).status, 'completed');
    assert.equal(calls, 1);
    assert.equal(
      JSON.stringify(run.agents.find((agent) => agent.id === 'founder')!.output),
      before,
    );
    const review = await fetch(`${base}/api/investigations/finishable/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewNotes: 'Historical estimates do not establish current ARR.' }),
    });
    assert.equal(review.status, 202);
    assert.equal(calls, 2);
    assert.equal(run.reviewNotes?.length, 1);
    assert.ok(run.events.some((event) => event.type === 'assessment_invalidated'));
    const repeated = await fetch(`${base}/api/investigations/finishable/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewNotes: 'Try another unbounded review.' }),
    });
    assert.equal(repeated.status, 202);
    assert.equal(calls, 3);
    assert.equal(run.reviewNotes?.length, 2);
    const capped = await fetch(`${base}/api/investigations/finishable/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewNotes: 'A third review must be rejected.' }),
    });
    assert.equal(capped.status, 409);
    assert.equal(calls, 3);
    assert.equal(run.reviewNotes?.length, 2);
  } finally {
    instance.shutdown();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('report exports corrections and source-quality caveats beside historical findings', () => {
  const run = structuredClone(sampleInvestigation);
  run.reviewNotes = ['A weekly count does not establish a historical monthly denominator.'];
  run.evidence[0].correction = 'The source does not support the original customer attribution.';
  run.evidence[0].status = 'CONTRADICTED';
  const report = renderReport(run);
  assert.match(report, /Source-quality review/);
  assert.match(report, /historical monthly denominator/);
  assert.match(report, /Verification correction:/);
  assert.match(report, /Cited evidence revised/);
});
