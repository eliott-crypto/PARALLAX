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
    `Model: ${run.model ?? 'Editorial sample'}`,
    `Provider usage: ${run.totalInputTokens} input / ${run.totalOutputTokens} output tokens`,
    `Decision: ${run.decision ?? 'INSUFFICIENT EVIDENCE'}`,
    `Research confidence: ${run.confidence} (evidence quality, not a return probability)`,
    '',
    `Query: ${clean(run.query)}`,
    '',
  ];
  const ordered = [
    ...run.agents.filter((agent) => agent.id === 'committee'),
    ...run.agents.filter((agent) => agent.id !== 'committee'),
  ];
  for (const runAgent of ordered) {
    const agent = AGENTS.find((a) => a.id === runAgent.id)!;
    lines.push(
      `## ${runAgent.id === 'committee' ? 'Final assessment' : 'Historical research'} — ${agent.name}`,
      '',
    );
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
      const revised = finding.evidenceIds.some((id) => evidence.get(id)?.correction)
        ? ' **Cited evidence revised; see source corrections.**'
        : '';
      lines.push(`- **${finding.kind}: ${finding.title}** — ${finding.detail} ${refs}${revised}`);
    }
    if (output.verification) lines.push('', `Verification: ${output.verification}`);
    if (output.revision) lines.push('', `Revision: ${output.revision}`);
    if (output.questions.length)
      lines.push('', 'Open questions:', ...output.questions.map((q) => `- ${q}`));
    lines.push('');
    if (runAgent.id === 'committee') {
      if (run.reviewNotes?.length)
        lines.push(
          '## Source-quality review',
          '',
          ...run.reviewNotes.map((note) => `- ${note}`),
          '',
          'The final committee assessment incorporates these qualifications. Earlier agent outputs remain as an audit trail.',
          '',
        );
    }
  }
  lines.push('## Sources', '');
  for (const e of run.evidence)
    lines.push(
      `- [${e.id}: ${e.title}](${e.url}) — ${e.publisher}. ${e.publishedAt ? `Reported publication ${e.publishedAt}. ` : 'Publication date unknown. '}Retrieved ${e.retrievedAt}. ${e.type}. ${e.status}. ${e.summary}${e.correction ? ` **Verification correction: ${e.correction}**` : ''}`,
    );
  lines.push(
    '',
    'Prepared for research prioritisation. Private-company financials remain unknown unless supported by linked public evidence.',
  );
  return lines.join('\n');
}
