import { loadEnvironment } from '../server/environment';
loadEnvironment();
import assert from 'node:assert/strict';
import { runClaudeAgent, TokenBudget } from '../server/claude';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    'Set ANTHROPIC_API_KEY in the local .env file before running the paid live smoke test.',
  );
  process.exit(1);
}
const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
console.log(`Checking ${model} with real web search. This consumes Anthropic API credits.`);
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 180000);
try {
  const result = await runClaudeAgent({
    namespace: 'smoke',
    role: 'A careful public-source research analyst',
    task: 'Search official sources to establish what Browserbase builds. Return one or two concise findings with actual source evidence. Do not estimate financial metrics.',
    context: { company: 'Browserbase' },
    previousEvidence: [],
    budget: new TokenBudget(30000),
    signal: controller.signal,
    requireSearch: true,
  });
  assert.ok(result.searches > 0, 'No real search tool call executed');
  assert.ok(result.output.evidence.length > 0, 'No retrieved citations admitted');
  console.log(
    JSON.stringify(
      {
        model,
        searches: result.searches,
        evidence: result.output.evidence.map((e) => ({ id: e.id, url: e.url, title: e.title })),
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
      null,
      2,
    ),
  );
  console.log('PASS: real Claude call, search execution, structured output and source admission.');
} finally {
  clearTimeout(timeout);
}
