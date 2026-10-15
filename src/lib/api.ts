/// <reference types="vite/client" />
import type { ThemeBoard } from '../../shared/boards';
import type { ApiStatus, Investigation, RadarData } from '../../shared/types';
import { renderReport } from '../../server/report';

export const OUTPUT_MODE = import.meta.env?.VITE_OUTPUT_MODE === 'true';
export const OUTPUT_MESSAGE =
  'This public output contains saved real Claude research. New investigations run in the local app with a server-side Claude connection.';
interface ResearchOutput {
  generatedAt?: string;
  boards: ThemeBoard[];
  investigations: Investigation[];
  radar?: RadarData;
  artifacts?: Record<string, string>;
}
let outputPromise: Promise<ResearchOutput> | undefined;
const OUTPUT_ORDER_KEY = 'parallax-output-priorities-v1';
const OUTPUT_WATCH_KEY = 'parallax-output-saved-v1';
function readLocal<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}
function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error('Your browser could not save this preference.');
  }
}
function recordedSnapshot(input: ResearchOutput): ResearchOutput {
  const snapshot = structuredClone(input);
  for (const board of snapshot.boards) {
    board.mode = 'recorded';
    if (board.status === 'running') {
      board.status = 'partial';
      board.error = [
        board.error,
        'Snapshot captured while research was in progress. The public copy does not continue research.',
      ]
        .filter(Boolean)
        .join(' ');
    }
  }
  for (const run of snapshot.investigations) {
    if (run.mode !== 'sample') run.mode = 'recorded';
    if (run.status === 'running') {
      run.status = 'partial';
      run.error = [
        run.error,
        'Snapshot captured while research was in progress. The public copy does not continue research.',
      ]
        .filter(Boolean)
        .join(' ');
    }
  }
  return snapshot;
}
async function outputSnapshot() {
  if (!outputPromise)
    outputPromise = fetch(`${import.meta.env?.BASE_URL || '/'}output/research.json`).then(
      async (response) => {
        if (!response.ok)
          throw new Error('The published research snapshot is unavailable. Please reload shortly.');
        const body = (await response.json()) as ResearchOutput;
        if (!Array.isArray(body.boards) || !Array.isArray(body.investigations))
          throw new Error('The research snapshot is incomplete.');
        return recordedSnapshot(body);
      },
    );
  return outputPromise;
}
function outputBoard(board: ThemeBoard): ThemeBoard {
  const local = readLocal<Record<string, { order: string[]; updatedAt: string }>>(
    OUTPUT_ORDER_KEY,
    {},
  )[board.id];
  if (!local) return structuredClone(board);
  const order = new Map(local.order.map((id, index) => [id, index + 1]));
  return {
    ...structuredClone(board),
    updatedAt: local.updatedAt,
    candidates: board.candidates.map((candidate) => {
      const next = { ...candidate };
      delete next.manualRank;
      if (order.has(candidate.company.id)) next.manualRank = order.get(candidate.company.id);
      return next;
    }),
  };
}
function outputRun(run: Investigation): Investigation {
  const watched = readLocal<Record<string, boolean>>(OUTPUT_WATCH_KEY, {});
  return { ...structuredClone(run), watched: watched[run.id] ?? run.watched };
}
async function outputApi<T>(path: string, options?: RequestInit): Promise<T> {
  const snapshot = await outputSnapshot();
  const method = (options?.method || 'GET').toUpperCase();
  const pathname = path.split('?')[0].replace(/\/$/, '');
  const body =
    typeof options?.body === 'string' ? (JSON.parse(options.body) as Record<string, unknown>) : {};
  const boards = snapshot.boards.map(outputBoard);
  const runs = snapshot.investigations.map(outputRun);
  let result: unknown;
  if (method === 'GET' && pathname === '/api/output')
    result = { generatedAt: snapshot.generatedAt, artifacts: snapshot.artifacts || {} };
  else if (method === 'GET' && pathname === '/api/status')
    result = {
      configured: false,
      activeRuns: 0,
      model: runs.find((run) => run.model)?.model || 'Recorded Claude research',
      committeeModel: runs
        .flatMap((run) => run.agents)
        .find((agent) => agent.id === 'committee' && agent.model)?.model,
      version: 'Public recorded output',
      webSearch: 'Saved real Claude web research',
    } satisfies ApiStatus;
  else if (method === 'GET' && pathname === '/api/boards') result = boards;
  else if (method === 'GET' && pathname === '/api/investigations') result = runs;
  else if (method === 'GET' && pathname === '/api/sample')
    result = runs.find((run) => run.status === 'completed') || runs[0] || null;
  else if (method === 'GET' && pathname === '/api/radar')
    result =
      snapshot.radar ||
      ({
        signals: [],
        evidence: [],
        mode: 'sample',
        updatedAt: snapshot.generatedAt || boards[0]?.updatedAt || '',
      } satisfies RadarData);
  else {
    const boardId = pathname.match(/^\/api\/boards\/([^/]+)$/)?.[1];
    const runId = pathname.match(/^\/api\/investigations\/([^/]+)$/)?.[1];
    if (boardId) {
      const board = boards.find((item) => item.id === decodeURIComponent(boardId));
      if (!board) throw new Error('This theme is not included in the published output.');
      if (method === 'GET') result = board;
      else if (method === 'PATCH' && (body.resetOrder === true || Array.isArray(body.order))) {
        const order = body.resetOrder === true ? [] : (body.order as string[]);
        const expected = board.candidates.map((candidate) => candidate.company.id);
        if (
          body.resetOrder !== true &&
          (order.length !== expected.length ||
            new Set(order).size !== order.length ||
            order.some((id) => !expected.includes(id)))
        )
          throw new Error('The company order is invalid.');
        const local = readLocal<Record<string, { order: string[]; updatedAt: string }>>(
          OUTPUT_ORDER_KEY,
          {},
        );
        local[board.id] = { order, updatedAt: new Date().toISOString() };
        writeLocal(OUTPUT_ORDER_KEY, local);
        result = outputBoard(snapshot.boards.find((item) => item.id === board.id)!);
      } else throw new Error(OUTPUT_MESSAGE);
    } else if (runId) {
      const run = runs.find((item) => item.id === decodeURIComponent(runId));
      if (!run) throw new Error('This investigation is not included in the published output.');
      if (method === 'GET') result = run;
      else if (method === 'PATCH' && typeof body.watched === 'boolean') {
        const saved = readLocal<Record<string, boolean>>(OUTPUT_WATCH_KEY, {});
        saved[run.id] = body.watched;
        writeLocal(OUTPUT_WATCH_KEY, saved);
        result = { ...run, watched: body.watched };
      } else throw new Error(OUTPUT_MESSAGE);
    } else throw new Error(OUTPUT_MESSAGE);
  }
  return result as T;
}
export function exportInvestigation(run: Investigation) {
  if (!OUTPUT_MODE) {
    window.open(`/api/investigations/${encodeURIComponent(run.id)}/export`, '_blank', 'noopener');
    return;
  }
  const url = URL.createObjectURL(
    new Blob([renderReport(run)], { type: 'text/markdown;charset=utf-8' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `parallax-${run.id}.md`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  if (OUTPUT_MODE) return outputApi<T>(path, options);
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error || body.message || `Request failed (${response.status})`);
  return body as T;
}
export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
export function readable(value: string) {
  return value.replaceAll('_', ' ').toLowerCase();
}
export function canonicalSourceUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^(fbclid|gclid|msclkid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.href;
  } catch {
    return value.trim();
  }
}
export function uniqueSources<T extends { url: string }>(records: readonly T[]): T[] {
  return [...new Map(records.map((record) => [canonicalSourceUrl(record.url), record])).values()];
}
export function sourceCount(records: readonly { url: string }[]): number {
  return uniqueSources(records).length;
}
export function dateLabel(value?: string | null) {
  if (!value) return 'Date not specified';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
