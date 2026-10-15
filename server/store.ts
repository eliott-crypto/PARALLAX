import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { Investigation, RadarData } from '../shared/types';
import type { ThemeBoard } from '../shared/boards';

/** Single-process durable store. Atomic replacement prevents a torn snapshot. */
export class ResearchStore {
  private directory: string;
  readonly investigations = new Map<string, Investigation>();
  readonly boards = new Map<string, ThemeBoard>();
  radar?: RadarData;
  constructor(directory = resolve('.data')) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true });
    const path = join(directory, 'research.json');
    if (existsSync(path)) {
      let data: { investigations?: Investigation[]; radar?: RadarData; boards?: ThemeBoard[] };
      try {
        data = JSON.parse(readFileSync(path, 'utf8'));
      } catch {
        throw new Error(
          'Research storage is unreadable. Preserve .data/research.json and restore a valid backup before restarting.',
        );
      }
      this.radar = data.radar;
      for (const board of data.boards ?? []) {
        if (board.status === 'running') {
          board.status = board.candidates.length ? 'partial' : 'failed';
          board.error =
            'The server restarted during shortlist research. Earlier findings are preserved; refresh this theme to continue.';
          for (const agent of board.agents)
            if (agent.status === 'running') {
              agent.status = 'failed';
              agent.error = 'Interrupted by server restart';
            }
        }
        this.boards.set(board.id, board);
      }
      for (const run of data.investigations ?? []) {
        if (run.status === 'running') {
          run.status = 'partial';
          run.error =
            'The server restarted during this investigation. Completed findings were preserved. Start a new investigation to continue researching.';
          for (const agent of run.agents)
            if (agent.status === 'running') {
              agent.status = 'failed';
              agent.error = 'Interrupted by server restart';
            }
        }
        this.investigations.set(run.id, run);
      }
    }
  }
  save(run?: Investigation) {
    if (run) this.investigations.set(run.id, run);
    const temp = join(this.directory, 'research.json.tmp');
    writeFileSync(
      temp,
      JSON.stringify({
        investigations: [...this.investigations.values()],
        radar: this.radar,
        boards: [...this.boards.values()],
      }),
      { mode: 0o600 },
    );
    renameSync(temp, join(this.directory, 'research.json'));
  }
  list() {
    return [...this.investigations.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
