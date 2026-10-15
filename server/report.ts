import { AGENTS, type Investigation } from '../shared/types';
const clean = (text: string) => text.replace(/[\r\n]+/g, ' ');
export function renderReport(run: Investigation): string {
  const evidence = new Map(run.evidence.map((e) => [e.id, e]));
  const lines = [
    `# PARALLAX — ${clean(run.title)}`,
    '',
    `Mode: ${run.mode === 'sample' ? 'Curated research sample — not a Claude execution' : 'Saved Claude investigation'}`,
    `Created: ${run.createdAt}`,
    `Status: ${run.status}`,
    `Decision: ${run.decision ?? 'INSUFFICIENT EVIDENCE'}`,
    `Research confidence: ${run.confidence} (evidence quality, not a return probability)`,
    '',
    `Query: ${clean(run.query)}`,
    '',
  ];
  for (const runAgent of run.agents) {
    const agent = AGENTS.find((a) => a.id === runAgent.id)!;
    lines.push(`## ${agent.name}`, '');
    if (!runAgent.output) {
      lines.push(runAgent.error || 'No completed findings.', '');
      continue;
    }
    const output = runAgent.output;
    lines.push(output.summary, '');
    for (const finding of output.findings) {
      const refs = finding.evidenceIds
        .map((id) => evidence.get(id))
        .filter(Boolean)
        .map((e) => `[${e!.id}](${e!.url})`)
        .join(' ');
      lines.push(`- **${finding.kind}: ${finding.title}** — ${finding.detail} ${refs}`);
    }
    if (output.verification) lines.push('', `Verification: ${output.verification}`);
    if (output.revision) lines.push('', `Revision: ${output.revision}`);
    if (output.questions.length)
      lines.push('', 'Open questions:', ...output.questions.map((q) => `- ${q}`));
    lines.push('');
  }
  lines.push('## Sources', '');
  for (const e of run.evidence)
    lines.push(
      `- [${e.id}: ${e.title}](${e.url}) — ${e.publisher}. ${e.publishedAt ? `Published ${e.publishedAt}. ` : 'Publication date unknown. '}Retrieved ${e.retrievedAt}. ${e.type}. ${e.status}. ${e.summary}`,
    );
  lines.push(
    '',
    'Prepared for research prioritisation. Private-company financials remain unknown unless supported by linked public evidence.',
  );
  return lines.join('\n');
}
