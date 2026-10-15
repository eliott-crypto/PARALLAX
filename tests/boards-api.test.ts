import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app';
import type { runThemeBoard } from '../server/boards';
import { ResearchStore } from '../server/store';
import type { ThemeBoard, BoardCandidate } from '../shared/boards';
import type { AgentEvent, Evidence, Investigation } from '../shared/types';
import type { runInvestigation } from '../server/orchestrator';

const jsonHeaders = { 'Content-Type': 'application/json' };
const themeRequest = {
  title: 'Private infrastructure',
  thesis: 'Cheaper inference shifts demand toward paid infrastructure.',
};
const newEvidence: Evidence = {
  id: 'fresh-independent',
  claim: 'Fixture retention evidence has been independently checked.',
  url: 'https://research.example/independent-proof',
  title: 'Controlled independent source',
  publisher: 'research.example',
  publishedAt: '2026-01-10',
  retrievedAt: '2026-10-15T10:00:00Z',
  summary: 'A controlled integration fixture, not investment research.',
  type: 'INDEPENDENT_REPORT',
  status: 'SUPPORTED',
  company: 'Fixture A',
};
function candidate(index: number): BoardCandidate {
  const id = `fixture-${index}`;
  return {
    companyId: id,
    rank: index + 1,
    rationale: 'Controlled source-backed research candidate',
    company: {
      id,
      name: `Fixture ${index ? 'B' : 'A'}`,
      website: `https://${id}.example`,
      description: 'A private startup fixture',
      category: 'Infrastructure',
      alignment: 'Theme',
      strengths: [],
      uncertainty: 'Retention unknown',
      confidence: 'LOW',
      evidenceIds: [newEvidence.id],
    },
    valuation: {
      amountUsd: (index + 1) * 1e9,
      asOf: '2025-05',
      label: 'Historical financing valuation',
      round: 'Series B',
      basis: 'UNDISCLOSED_BASIS',
      evidenceIds: [newEvidence.id],
    },
    priceSignal: 'MIXED',
    priceReason: 'Uncertain comparison',
    bullCase: 'Demand may grow',
    bearCase: 'Competition may commoditise this',
    killCriterion: 'Paid retention falls below a viable level',
    nextProof: 'Obtain sourced paid-retention evidence',
    confidence: 'LOW',
    evidenceIds: [newEvidence.id],
  };
}
function populate(board: ThemeBoard) {
  board.candidates = [candidate(0), candidate(1)];
  board.evidence = [
    {
      ...newEvidence,
      id: 'original-evidence',
      url: 'https://research.example/original',
      claim: 'Original source retained',
    },
  ];
  board.summary = 'Controlled completed shortlist';
  board.confidence = 'LOW';
}
const completedBoardRunner: typeof runThemeBoard = async (board, onUpdate) => {
  populate(board);
  board.status = 'completed';
  await onUpdate(board);
};
const completedRunner: typeof runInvestigation = async (run, onUpdate) => {
  run.status = 'completed';
  run.confidence = 'MEDIUM';
  run.decision = 'MONITOR';
  onUpdate({
    id: 'done',
    investigationId: run.id,
    timestamp: new Date().toISOString(),
    type: 'report.completed',
    message: 'Controlled completion',
  });
};
async function fixture(
  overrides: { boardRunner?: typeof runThemeBoard; runner?: typeof runInvestigation } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'parallax-boards-api-'));
  const store = new ResearchStore(directory);
  const instance = createApp({
    store,
    recordings: [],
    configured: () => true,
    boardRunner: overrides.boardRunner || completedBoardRunner,
    runner: overrides.runner || completedRunner,
  });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    directory,
    store,
    instance,
    base,
    async request(path: string, method = 'GET', body?: unknown) {
      return fetch(`${base}${path}`, {
        method,
        headers: jsonHeaders,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    },
    async close() {
      instance.shutdown();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('theme API creates, lists and loads a board; invalid themes and unknown IDs are explicit', async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await f.request('/api/boards', 'POST', { title: 'x', thesis: 'too short' })).status,
      400,
    );
    const hostile = await fetch(`${f.base}/api/boards`, {
      method: 'POST',
      headers: { ...jsonHeaders, Origin: 'https://unrelated.example' },
      body: JSON.stringify(themeRequest),
    });
    assert.equal(hostile.status, 403);
    const response = await f.request('/api/boards', 'POST', themeRequest);
    assert.equal(response.status, 202);
    const board: ThemeBoard = await response.json();
    const loaded: ThemeBoard = await (await f.request(`/api/boards/${board.id}`)).json();
    assert.equal(loaded.title, themeRequest.title);
    assert.equal(loaded.candidates.length, 2);
    assert.equal(loaded.status, 'completed');
    const list: ThemeBoard[] = await (await f.request('/api/boards')).json();
    assert.deepEqual(
      list.map((entry) => entry.id),
      [board.id],
    );
    assert.equal((await f.request('/api/boards/missing')).status, 404);
    assert.equal((await f.request('/api/boards/missing/refresh', 'POST')).status, 404);
    assert.equal((await f.request('/api/boards/missing/cancel', 'POST')).status, 404);
  } finally {
    await f.close();
  }
});

test('manual reorder validates a complete permutation, persists, and reset preserves agent rank', async () => {
  const f = await fixture();
  try {
    const board: ThemeBoard = await (await f.request('/api/boards', 'POST', themeRequest)).json();
    const path = `/api/boards/${board.id}`;
    for (const order of [['fixture-0'], ['fixture-0', 'fixture-0'], ['fixture-0', 'unknown']]) {
      assert.equal((await f.request(path, 'PATCH', { order })).status, 400);
    }
    assert.equal((await f.request(path, 'PATCH', {})).status, 400);
    const reordered: ThemeBoard = await (
      await f.request(path, 'PATCH', { order: ['fixture-1', 'fixture-0'] })
    ).json();
    assert.deepEqual(
      reordered.candidates.map((row) => [row.companyId, row.rank, row.manualRank]),
      [
        ['fixture-0', 1, 2],
        ['fixture-1', 2, 1],
      ],
    );
    const restored = new ResearchStore(f.directory).boards.get(board.id)!;
    assert.deepEqual(
      restored.candidates.map((row) => row.manualRank),
      [2, 1],
    );
    const reset: ThemeBoard = await (await f.request(path, 'PATCH', { resetOrder: true })).json();
    assert.deepEqual(
      reset.candidates.map((row) => row.rank),
      [1, 2],
    );
    assert.ok(reset.candidates.every((row) => row.manualRank === undefined));
    assert.ok(
      new ResearchStore(f.directory).boards
        .get(board.id)!
        .candidates.every((row) => row.manualRank === undefined),
    );
  } finally {
    await f.close();
  }
});

test('running teams share concurrency guards and cancellation releases capacity without losing completed research', async () => {
  const f = await fixture({
    boardRunner: async (board, onUpdate, signal) => {
      populate(board);
      board.agents[0].status = 'completed';
      board.agents[1].status = 'running';
      await onUpdate(board);
      await new Promise<void>((resolve) => {
        if (signal?.aborted) resolve();
        else signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      board.agents[1].status = 'failed';
    },
  });
  try {
    const first: ThemeBoard = await (await f.request('/api/boards', 'POST', themeRequest)).json();
    const second = await f.request('/api/boards', 'POST', {
      ...themeRequest,
      title: 'Other theme',
    });
    assert.equal(second.status, 202);
    assert.equal((await f.request('/api/boards', 'POST', themeRequest)).status, 409);
    assert.equal(
      (await f.request('/api/investigations', 'POST', { query: 'Another research task' })).status,
      409,
    );
    assert.equal((await f.request(`/api/boards/${first.id}/refresh`, 'POST')).status, 409);
    assert.equal(
      (await f.request(`/api/boards/${first.id}`, 'PATCH', { order: ['fixture-1', 'fixture-0'] }))
        .status,
      409,
    );
    assert.equal(
      (await f.request(`/api/boards/${first.id}/candidates/fixture-0/research`, 'POST', {})).status,
      409,
    );
    const cancelled: ThemeBoard = await (
      await f.request(`/api/boards/${first.id}/cancel`, 'POST')
    ).json();
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.candidates.length, 2);
    assert.equal(cancelled.agents[0].status, 'completed');
    for (let tries = 0; tries < 10; tries++) {
      const status = await (await f.request('/api/status')).json();
      if (status.activeRuns === 1) break;
      if (tries === 9) assert.fail('Cancelled team did not release concurrency capacity');
    }
    assert.equal(
      (await f.request('/api/boards', 'POST', { ...themeRequest, title: 'Released slot' })).status,
      202,
    );
  } finally {
    await f.close();
  }
});

test('candidate Red Team review streams fresh evidence and confidence without changing the comparative rank', async () => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started: Investigation | undefined;
  const f = await fixture({
    runner: async (run, onUpdate, signal) => {
      started = run;
      await Promise.race([
        ready,
        new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        ),
      ]);
      if (signal.aborted) return;
      run.evidence = [newEvidence];
      run.status = 'completed';
      run.completedAt = new Date().toISOString();
      run.confidence = 'MEDIUM';
      run.decision = 'MONITOR';
      const committee = run.agents.find((agent) => agent.id === 'committee')!;
      committee.status = 'completed';
      committee.output = {
        summary: 'Independent sources changed the assessment.',
        findings: [
          {
            title: 'Retention checked',
            detail: 'Controlled fresh evidence',
            evidenceIds: [newEvidence.id],
            kind: 'FACT',
          },
        ],
        evidence: [],
        questions: [],
        confidence: 'MEDIUM',
      };
      const verifier = run.agents.find((agent) => agent.id === 'verifier')!;
      verifier.status = 'completed';
      verifier.output = {
        summary: 'Checked independently',
        findings: [],
        evidence: [],
        questions: [],
        confidence: 'MEDIUM',
        verification: 'PARTIALLY SUPPORTED',
      };
      const event: AgentEvent = {
        id: 'fresh-finished',
        investigationId: run.id,
        timestamp: run.completedAt,
        type: 'report.completed',
        message: 'Controlled fresh review',
      };
      run.events.push(event);
      onUpdate(event);
    },
  });
  const streamAbort = new AbortController();
  const timer = setTimeout(() => streamAbort.abort(), 5000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const board: ThemeBoard = await (await f.request('/api/boards', 'POST', themeRequest)).json();
    await f.request(`/api/boards/${board.id}`, 'PATCH', { order: ['fixture-1', 'fixture-0'] });
    const unknown = await f.request(
      `/api/boards/${board.id}/candidates/missing/research`,
      'POST',
      {},
    );
    assert.equal(unknown.status, 404);
    assert.equal(
      (
        await f.request(`/api/boards/${board.id}/candidates/fixture-0/research`, 'POST', {
          unexpected: true,
        })
      ).status,
      400,
    );
    const response = await f.request(
      `/api/boards/${board.id}/candidates/fixture-0/research`,
      'POST',
      { challenge: true },
    );
    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.equal(payload.board.candidates[0].researchId, payload.investigation.id);
    assert.equal(started?.company?.id, 'fixture-0');
    assert.match(started!.query, /RED TEAM/);
    assert.match(started!.query, /Paid retention falls below a viable level/);
    assert.match(started!.query, /Obtain sourced paid-retention evidence/);
    assert.equal(
      (await f.request(`/api/boards/${board.id}/candidates/fixture-0/research`, 'POST', {})).status,
      409,
    );
    const stream = await fetch(`${f.base}/api/boards/${board.id}/events`, {
      signal: streamAbort.signal,
    });
    assert.match(stream.headers.get('Content-Type')!, /text\/event-stream/);
    reader = stream.body!.getReader();
    const initial = new TextDecoder().decode((await reader.read()).value);
    assert.match(initial, new RegExp(payload.investigation.id));
    release();
    let updated: ThemeBoard | undefined;
    let buffer = '';
    while (!updated) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      buffer += new TextDecoder().decode(chunk.value);
      const messages = buffer.split('\n\n');
      buffer = messages.pop() || '';
      for (const message of messages)
        if (message.startsWith('data: ')) {
          const snapshot: ThemeBoard = JSON.parse(message.slice(6));
          if (snapshot.candidates[0].latestReview) updated = snapshot;
        }
    }
    const reviewed = updated.candidates[0];
    assert.equal(reviewed.latestReview?.confidence, 'MEDIUM');
    assert.equal(reviewed.latestReview?.verification, 'PARTIALLY SUPPORTED');
    assert.equal(reviewed.latestReview?.investigationId, payload.investigation.id);
    assert.deepEqual(reviewed.latestReview?.evidenceIds, [newEvidence.id]);
    assert.deepEqual(
      updated.candidates.map((row) => [row.rank, row.manualRank]),
      [
        [1, 2],
        [2, 1],
      ],
    );
    assert.equal(updated.evidence.filter((entry) => entry.id === newEvidence.id).length, 1);
    assert.ok(updated.evidence.some((entry) => entry.id === 'original-evidence'));
    assert.equal(
      new ResearchStore(f.directory).boards.get(board.id)?.candidates[0].latestReview?.confidence,
      'MEDIUM',
    );
  } finally {
    clearTimeout(timer);
    release();
    await reader?.cancel();
    streamAbort.abort();
    await f.close();
  }
});
