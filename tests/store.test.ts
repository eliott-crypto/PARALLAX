import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResearchStore } from '../server/store';
import type { Investigation } from '../shared/types';

test('atomic store persists findings and marks interrupted research partial on restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'parallax-store-'));
  try {
    const store = new ResearchStore(directory);
    const run: Investigation = {
      id: 'one',
      title: 'Investigation',
      query: 'browser infrastructure',
      mode: 'live',
      status: 'running',
      createdAt: new Date().toISOString(),
      agents: [
        { id: 'scout', status: 'completed' },
        { id: 'causal', status: 'running' },
      ],
      events: [],
      evidence: [],
      confidence: 'LOW',
      watched: true,
      totalInputTokens: 30,
      totalOutputTokens: 10,
    };
    store.save(run);
    const restored = new ResearchStore(directory).investigations.get('one')!;
    assert.equal(restored.status, 'partial');
    assert.equal(restored.agents[0].status, 'completed');
    assert.equal(restored.agents[1].status, 'failed');
    assert.equal(restored.watched, true);
    assert.equal(restored.totalInputTokens, 30);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('corrupt storage fails visibly rather than silently overwriting investigations', () => {
  const directory = mkdtempSync(join(tmpdir(), 'parallax-corrupt-'));
  try {
    writeFileSync(join(directory, 'research.json'), '{broken');
    assert.throws(() => new ResearchStore(directory), /unreadable/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
