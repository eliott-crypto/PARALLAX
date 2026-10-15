import { existsSync, readFileSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const snapshotPath = resolve(root, 'public/output/research.json');
if (!existsSync(snapshotPath))
  throw new Error(
    'Create public/output/research.json from actual saved research before building the public output.',
  );
const raw = readFileSync(snapshotPath, 'utf8');
if (
  /sk-ant-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(
    raw,
  )
)
  throw new Error('The research snapshot failed the credential check.');
const snapshot = JSON.parse(raw) as {
  boards?: unknown[];
  investigations?: { mode?: string }[];
  artifacts?: Record<string, string>;
};
if (!Array.isArray(snapshot.boards) || !Array.isArray(snapshot.investigations))
  throw new Error('The output requires boards and investigations arrays.');
if (snapshot.investigations.some((run) => run.mode === 'sample'))
  throw new Error('Publish actual saved executions, not the curated sample.');
const env = { ...process.env, VITE_OUTPUT_MODE: 'true' };
for (const args of [
  ['node_modules/typescript/bin/tsc', '--noEmit'],
  ['node_modules/vite/bin/vite.js', 'build', '--outDir', 'dist-output'],
]) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
const artifacts: Record<string, string> = {};
for (const [source, target, label] of [
  ['docs/submission/pitch.pdf', 'pitch.pdf', 'pitch'],
  ['docs/submission/run-proof.zip', 'run-proof.zip', 'proof'],
]) {
  if (!existsSync(resolve(root, source))) continue;
  copyFileSync(resolve(root, source), resolve(root, 'dist-output', target));
  artifacts[label] = target;
}
mkdirSync(resolve(root, 'dist-output/output'), { recursive: true });
writeFileSync(
  resolve(root, 'dist-output/output/research.json'),
  JSON.stringify({ ...snapshot, artifacts }),
);
writeFileSync(resolve(root, 'dist-output/.nojekyll'), '');
console.log(
  `Public recorded output built in dist-output (${snapshot.boards.length} themes, ${snapshot.investigations.length} actual investigations).`,
);
