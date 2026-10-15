import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createThemeBoard } from '../server/boards';
import { loadBoardRecordings, validateRecordedBoard } from '../server/board-recordings';
import type { BoardAgent, BoardAgentId, BoardCandidate, ThemeBoard } from '../shared/boards';
import type { AgentOutput, Evidence } from '../shared/types';

const stamp = '2026-10-15T10:00:00Z';
function fixture(): ThemeBoard {
  const board = createThemeBoard(
    'Infrastructure',
    'Cheaper inference creates infrastructure demand.',
  );
  board.status = 'completed';
  board.summary = 'Controlled validation fixture, not real research.';
  board.confidence = 'LOW';
  board.createdAt = stamp;
  board.updatedAt = stamp;
  board.evidence = Array.from({ length: 5 }, (_, index): Evidence => ({
    id: `price-${index}`,
    claim: `Fixture ${index} announced a $${index + 1} billion valuation in May 2025.`,
    url: `https://fixture${index}.example/financing`,
    title: 'Controlled primary source',
    publisher: `fixture${index}.example`,
    publishedAt: '2025-05-20',
    retrievedAt: stamp,
    summary: 'Historical financing valuation fixture.',
    type: 'FIRST_PARTY_COMPANY_CLAIM',
    status: 'SUPPORTED',
    company: `Fixture ${index}`,
  }));
  board.candidates = board.evidence.map((entry, index): BoardCandidate => ({
    companyId: `company-${index}`,
    rank: index + 1,
    rationale: 'Source-backed research priority fixture',
    company: {
      id: `company-${index}`,
      name: `Fixture ${index}`,
      website: `https://fixture${index}.example`,
      description: 'Private infrastructure company fixture',
      category: 'Infrastructure',
      alignment: 'Theme',
      strengths: [],
      uncertainty: 'Retention unknown',
      confidence: 'LOW',
      evidenceIds: [entry.id],
    },
    valuation: {
      amountUsd: (index + 1) * 1e9,
      asOf: '2025-05',
      label: 'Historical disclosed financing valuation',
      round: 'Series B',
      basis: 'UNDISCLOSED_BASIS',
      evidenceIds: [entry.id],
    },
    priceSignal: 'MIXED',
    priceReason: 'Commercial proof uncertain',
    bullCase: 'Demand could grow',
    bearCase: 'Competition could capture value',
    killCriterion: 'No paid adoption',
    nextProof: 'Verify retention',
    confidence: 'LOW',
    evidenceIds: [entry.id],
  }));
  for (const agent of board.agents) {
    agent.status = 'completed';
    agent.startedAt = stamp;
    agent.completedAt = stamp;
    agent.model = 'claude-controlled-test';
    agent.inputTokens = 200;
    agent.outputTokens = 100;
    agent.searches = agent.id === 'ranking' ? 0 : 1;
    agent.output = {
      summary: 'Controlled completed stage',
      findings: [
        {
          title: 'Source checked',
          detail: 'Controlled evidence',
          evidenceIds: [board.evidence[0].id],
          kind: 'FACT',
        },
      ],
      evidence: [],
      questions: [],
      confidence: 'LOW',
      ...(agent.id === 'ranking'
        ? { shortlist: board.candidates.map(({ company: _company, ...candidate }) => candidate) }
        : {}),
    };
    for (const type of ['started', ...(agent.searches ? ['search'] : []), 'completed'] as const)
      board.events.push({
        id: `${agent.id}-${type}`,
        timestamp: stamp,
        agentId: agent.id,
        type: type as 'started' | 'search' | 'completed',
        message: 'Controlled actual-stage fixture',
      });
  }
  board.events.push({
    id: 'rank-finished',
    timestamp: stamp,
    type: 'ranking',
    message: 'Controlled final ranking',
  });
  board.totalInputTokens = 1000;
  board.totalOutputTokens = 500;
  return board;
}
function addRecoveredStage(board: ThemeBoard, id: BoardAgentId, output: AgentOutput) {
  const stage: BoardAgent = {
    id,
    name: id,
    status: 'completed',
    startedAt: stamp,
    completedAt: stamp,
    model: 'claude-controlled-recovery',
    searches: id.startsWith('ranking') ? 0 : 1,
    inputTokens: 100,
    outputTokens: 50,
    output: structuredClone(output),
  };
  board.agents.push(stage);
  for (const type of ['started', ...(stage.searches ? ['search'] : []), 'completed'] as const)
    board.events.push({
      id: `${id}-${type}`,
      timestamp: stamp,
      agentId: id,
      type: type as 'started' | 'search' | 'completed',
      message: 'Controlled recovery stage',
    });
  board.totalInputTokens += 100;
  board.totalOutputTokens += 50;
}

test('five priced source-backed execution rows validate on a clone labelled recorded', () => {
  const original = fixture();
  const replay = validateRecordedBoard(original);
  assert.equal(replay.mode, 'recorded');
  assert.equal(original.mode, 'live');
  assert.equal(replay.candidates.length, 5);
  assert.deepEqual(replay.events, original.events);
  replay.candidates[0].rationale = 'Local mutation';
  assert.notEqual(original.candidates[0].rationale, replay.candidates[0].rationale);
});

test('recording rejects zero usage, invented references, changed valuation amounts and lost search provenance', () => {
  const mutations: Array<(board: ThemeBoard) => void> = [
    (board) => {
      board.totalInputTokens = 0;
    },
    (board) => {
      board.agents[0].inputTokens = 0;
    },
    (board) => {
      board.candidates[0].valuation.evidenceIds = ['invented'];
    },
    (board) => {
      board.candidates[0].valuation.amountUsd = 50e9;
    },
    (board) => {
      board.candidates[0].valuation.asOf = '2099-05';
    },
    (board) => {
      board.candidates[0].evidenceIds.push('invented');
    },
    (board) => {
      board.events = board.events.filter((event) => event.type !== 'search');
    },
    (board) => {
      board.candidates.pop();
    },
    (board) => {
      board.agents[0].model = undefined;
    },
    (board) => {
      board.agents.find(
        (agent) => agent.id === 'ranking',
      )!.output!.shortlist![0].valuation.amountUsd = 2e9;
    },
    (board) => {
      board.evidence[0].status = 'CONTRADICTED';
    },
  ];
  for (const mutate of mutations) {
    const board = fixture();
    mutate(board);
    assert.throws(() => validateRecordedBoard(board));
  }
});

test('real budget interruptions remain in history when recovered valuation, Bear and committee finish', () => {
  const board = fixture();
  board.status = 'partial';
  for (const id of ['valuation', 'bear', 'ranking'] as const) {
    const original = board.agents.find((agent) => agent.id === id)!;
    addRecoveredStage(board, `${id}-gap`, original.output!);
    original.status = 'failed';
    original.error = 'Historical budget interruption';
    original.output = undefined;
  }
  const replay = validateRecordedBoard(board);
  assert.equal(replay.agents.find((agent) => agent.id === 'valuation')?.status, 'failed');
  assert.equal(replay.agents.find((agent) => agent.id === 'valuation-gap')?.status, 'completed');
  assert.equal(replay.candidates.length, 5);
  replay.agents.find((agent) => agent.id === 'ranking-gap')!.status = 'failed';
  assert.throws(() => validateRecordedBoard(replay), /completed ranking/);
});

test('loader tolerates absent directories and reads actual JSON without manufacturing execution events', () => {
  const directory = mkdtempSync(join(tmpdir(), 'parallax-board-recording-'));
  try {
    assert.deepEqual(loadBoardRecordings(join(directory, 'absent')), []);
    const board = fixture();
    writeFileSync(join(directory, 'controlled.json'), JSON.stringify(board));
    writeFileSync(join(directory, 'README.md'), 'Not a JSON execution');
    const loaded = loadBoardRecordings(directory);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].mode, 'recorded');
    assert.deepEqual(loaded[0].events, board.events);
    assert.equal(loaded[0].totalInputTokens, board.totalInputTokens);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
