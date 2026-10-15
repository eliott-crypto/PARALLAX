import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { validateRecording } from '../server/recordings';
import { renderReport } from '../server/report';
import type { Investigation } from '../shared/types';

const id = process.argv[2];
if (!id || !/^[\w-]+$/.test(id))
  throw new Error(
    'Usage: node --import tsx scripts/save-recording.ts <completed-investigation-id>',
  );
const data = JSON.parse(readFileSync(resolve('.data/research.json'), 'utf8')) as {
  investigations: Investigation[];
};
const run = data.investigations.find((candidate) => candidate.id === id);
if (!run) throw new Error('Investigation not found in the local store.');
const recording = validateRecording({ ...structuredClone(run), mode: 'recorded', watched: false });
const text = JSON.stringify(recording, null, 2);
if (/sk-ant-[\w-]{20,}|gh[pousr]_[\w]{20,}/.test(text))
  throw new Error('Possible credential found. Recording was not written.');
mkdirSync(resolve('recordings'), { recursive: true });
writeFileSync(join(resolve('recordings'), `${id}.json`), text + '\n');
writeFileSync(resolve('docs/RECORDED_INVESTIGATION.md'), renderReport(recording) + '\n');
console.log(
  JSON.stringify({
    saved: recording.id,
    status: recording.status,
    decision: recording.decision,
    records: recording.evidence.length,
    sources: new Set(recording.evidence.map((e) => e.url)).size,
    committeeModel: recording.agents.find((agent) => agent.id === 'committee')?.model,
  }),
);
