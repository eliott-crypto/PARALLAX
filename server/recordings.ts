import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { AGENTS, AgentOutputSchema, EvidenceSchema, type Investigation } from '../shared/types';

/** Only completed, source-backed executions may be shipped as a recorded demo. */
export function validateRecording(value: unknown): Investigation {
  const run = value as Investigation;
  if (
    !run ||
    run.mode !== 'recorded' ||
    run.status !== 'completed' ||
    !run.id ||
    !run.completedAt ||
    !(run.totalInputTokens > 0) ||
    !(run.totalOutputTokens > 0)
  )
    throw new Error('A recording must be a completed real execution with provider usage.');
  if (
    !Array.isArray(run.events) ||
    !run.events.some((e) => e.type === 'search_completed') ||
    !run.events.some((e) => e.type === 'thesis_revised')
  )
    throw new Error('A recording must retain its actual search and revision audit trail.');
  if (!Array.isArray(run.evidence) || !run.evidence.length)
    throw new Error('A recording needs source-backed evidence.');
  const ids = new Set(run.evidence.map((e) => EvidenceSchema.parse(e).id));
  for (const definition of AGENTS) {
    const agent = run.agents.find((a) => a.id === definition.id);
    if (!agent || agent.status !== 'completed' || !agent.output)
      throw new Error(`Recording missing completed ${definition.id} stage.`);
    const output = AgentOutputSchema.parse(agent.output);
    for (const finding of output.findings)
      for (const id of finding.evidenceIds)
        if (!ids.has(id)) throw new Error(`Recording has an unknown evidence reference: ${id}`);
  }
  const verifier = run.agents.find((a) => a.id === 'verifier');
  if (!verifier?.output?.verification || !(verifier.searches! > 0))
    throw new Error('A recording must include genuine verification research.');
  return run;
}
export function loadRecordings(directory = resolve('recordings')): Investigation[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => validateRecording(JSON.parse(readFileSync(join(directory, name), 'utf8'))));
}
