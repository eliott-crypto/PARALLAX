# PARALLAX

**Find the opportunity before the consensus.** Autonomous venture intelligence that starts with a change in the world, discovers relevant companies, and challenges its own investment thesis.

## Run locally

Requires Node.js 22+.

```sh
npm install
# Set ANTHROPIC_API_KEY in .env.local (server-side only).
npm run dev
```

Open http://127.0.0.1:5173. Without an API key, explore the clearly labelled curated research sample. It is editorial research, not a recorded Claude investigation.

```sh
npm test
npm run build
npm start
```

After building, the server serves the production UI at http://127.0.0.1:3001.

## Real research architecture

Independent Claude Messages API calls form a bounded investigation graph:

```text
Scout → Causal Analyst → Company Hunter
                            ↓
          Founder Analyst ∥ Competitive Analyst
                            ↓
                      Bull ∥ Bear
                            ↓
                    Verifier (new search)
                            ↓
                  Bull revision (feedback)
                            ↓
                  Investment Committee
```

The frontend subscribes to server-sent events containing actual run state. Parallel stages share structured findings and admitted evidence. Search results are independently identifiable sources, not model-generated URLs. Research confidence describes evidence quality; it does not predict investment returns.

The server stores investigations and the latest radar in ignored `.data/research.json` via atomic replacement. A restart preserves completed findings and marks interrupted runs partial. Completed real runs can be reopened as recorded investigations. Watchtower rechecks are **on demand**, with no claim of background scheduling.

## Environment

- `ANTHROPIC_API_KEY`: required only for live research; read by the server from `.env.local` or `.env`, never sent to the browser.
- `ANTHROPIC_MODEL`: defaults to `claude-sonnet-4-6`.
- `APP_ORIGIN`: optional exact HTTPS origin for a deployment behind a reverse proxy.
- `PORT`: defaults to `3001`.
- `HOST`: defaults to loopback `127.0.0.1`; use `0.0.0.0` only in a protected deployment.
- `MAX_INVESTIGATION_SECONDS`: defaults to 480; bounded at 30–1800.
- `MAX_INVESTIGATION_TOKENS`: bounded research token budget.
- `MAX_RESEARCH_RUNS_PER_HOUR`: defaults to 20. At most two deep investigations run concurrently.

Search uses Anthropic's basic [`web_search_20250305`](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool), with per-agent search limits. The API organisation must have web search enabled. API errors, cancellation, partial findings, and missing credentials have explicit UI states.

## Deployment

This is a Node server application, not a static-only site. Use a persistent Node 22+ host with `npm ci && npm run build`, `npm start`, an environment-injected API key, and a durable volume mounted at `.data`. Protect any internet-facing deployment with your platform's access control to prevent unauthorised API spending. No external deployment is implied by a local build.

## Source integrity

Never commit `.env`, `.data`, credentials, or research access keys. Curated sample records use linked primary sources, explicitly labelled company claims and hypotheses, and unknown dates where publication dates are unavailable. Professional research is limited to public work history and corroborated identities. No private financial metrics are invented.

See [the three-minute demonstration](docs/DEMO.md).
