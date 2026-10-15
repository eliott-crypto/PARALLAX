import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { build } from 'vite';

test('published output loads one snapshot, disables live research, and stores only browser preferences', async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    define: {
      'import.meta.env.VITE_OUTPUT_MODE': '"true"',
      'import.meta.env.BASE_URL': '"/PARALLAX/"',
    },
    build: {
      write: false,
      minify: false,
      lib: { entry: resolve('src/lib/api.ts'), formats: ['es'], fileName: 'api' },
    },
  });
  const bundle = (Array.isArray(result) ? result[0] : result) as {
    output: { type: string; code?: string }[];
  };
  const code = bundle.output.find((entry) => entry.type === 'chunk')?.code;
  assert.ok(code);
  const storage = new Map<string, string>();
  const originalFetch = globalThis.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let fetches = 0;
  const snapshot = {
    boards: [
      {
        id: 'board',
        status: 'running',
        mode: 'live',
        updatedAt: '2026-10-15T10:00:00Z',
        candidates: [
          { company: { id: 'a' }, manualRank: 2 },
          { company: { id: 'b' }, manualRank: 1 },
        ],
      },
    ],
    investigations: [
      {
        id: 'run',
        mode: 'live',
        status: 'completed',
        model: 'actual-recorded-model',
        agents: [],
        watched: false,
      },
    ],
  };
  globalThis.fetch = async (input) => {
    fetches++;
    assert.equal(input, '/PARALLAX/output/research.json');
    return new Response(JSON.stringify(snapshot), { status: 200 });
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  try {
    const module = await import(
      `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
    );
    assert.equal(module.OUTPUT_MODE, true);
    const status = await module.api('/api/status');
    assert.equal(status.configured, false);
    assert.equal(status.activeRuns, 0);
    const boards = await module.api('/api/boards');
    assert.equal(boards[0].mode, 'recorded');
    assert.equal(boards[0].status, 'partial');
    assert.match(boards[0].error, /captured while research was in progress/i);
    await assert.rejects(
      module.post('/api/boards', { title: 'No live server' }),
      /saved real Claude research/,
    );
    await module.api('/api/boards/board', {
      method: 'PATCH',
      body: JSON.stringify({ order: ['a', 'b'] }),
    });
    const reordered = await module.api('/api/boards/board');
    assert.deepEqual(
      reordered.candidates.map((candidate: { manualRank: number }) => candidate.manualRank),
      [1, 2],
    );
    await assert.rejects(
      module.api('/api/boards/board', {
        method: 'PATCH',
        body: JSON.stringify({ order: ['a', 'a'] }),
      }),
      /invalid/,
    );
    await module.api('/api/boards/board', {
      method: 'PATCH',
      body: JSON.stringify({ resetOrder: true }),
    });
    assert.ok(
      (await module.api('/api/boards/board')).candidates.every(
        (candidate: { manualRank?: number }) => candidate.manualRank === undefined,
      ),
    );
    await module.api('/api/investigations/run', {
      method: 'PATCH',
      body: JSON.stringify({ watched: true }),
    });
    assert.equal((await module.api('/api/investigations/run')).watched, true);
    assert.equal(fetches, 1, 'viewing and browser preferences must not issue live API calls');
    assert.equal(
      snapshot.boards[0].status,
      'running',
      'the actual source snapshot remains unchanged',
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
