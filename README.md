# PARALLAX

**A shortlist you can challenge.** PARALLAX helps a venture investor answer: which niche private companies deserve my next diligence call, why now, and what would change my mind? Claude teams discover companies, verify disclosed financing valuations, compare the cases and investigate the weakest assumption.

## Run locally

Requires Node.js 22+.

```sh
npm install
# Set ANTHROPIC_API_KEY in .env.local (server-side only).
npm run dev
```

Open http://127.0.0.1:5173. You can also put the key in `.env`; a blank `.env.local` does not override it. Both files stay local. Without an API key, the bundled completed Browserbase investigation can be opened under **Research**. Fresh theme research requires a key. A completed five-company niche shortlist is bundled, with actual Claude execution records and an explicit assisted source audit. Four companies carry historical reported valuations at $100M or below; Arrakis is a larger $140M comparison.

```sh
npm test
npm run build
npm start
```

After building, the server serves the production UI at http://127.0.0.1:3001.

## Use the app

The app has three pages:

- **Themes:** create an investment theme and build its ranked shortlist. Discovery prefers less obvious private specialists with disclosed valuations of **$100M or below** by default; the preference can be changed. Each company opens to its niche, the world change creating demand, bull/bear cases, valuation evidence and a falsifiable kill criterion. Missing disclosed prices leave empty slots or unpriced leads, not invented entries.
- **Universe:** rotate a 3D evidence map of companies across your themes. Distance from the core reflects the share of cited evidence records currently supported; height reflects agent confidence. **Remove company claims** retains supported independent reporting, research publications and public professional records. Ghost positions reveal which companies lose support. This is a reversible evidence scenario, not a new research run or forecast.
- **Research:** follow the nine-agent deep investigations attached to shortlisted companies, or open the bundled real recorded investigation. Findings lead; the full team, original sources, source corrections and execution audit remain inspectable.

The ordinal ranking is a research priority, comparing thesis fit, sourced commercial proof, disclosed valuation and downside. **Lowest valuation first** sorts historical financing marks; the up/down controls save your own priority order. **Restore agent order** returns to the model's comparison. A low valuation alone does not establish good value.

**Send agents to test this** launches a fresh nine-agent follow-up on a company's weakest assumption. A completed assessment attaches its actual evidence, confidence and verdict to the company and updates its Universe position. It does not silently rerank the whole theme; **Refresh research** performs a new theme comparison.

Real website icons identify company and source domains. Source history shows recorded agent assessments and interpretation corrections, never an invented publisher score or investment hit rate. The full multi-agent graph, source corrections and execution audit remain available within each investigation.

## Real research architecture

Theme research starts with two independent scouts in parallel, then a price verifier and adversarial analyst in parallel, then a ranking agent. Bounded gap and replacement passes can search for missing priced candidates. The server checks company identities, valuation amount/date and supporting references before admitting a ranked company. Closed financing valuations count; funding amounts, SAFE caps, proposed rounds and issuer asking prices do not substitute for them. Up to five qualify; fewer is an explicit result.

Company follow-ups use independent Claude Messages API calls in a bounded investigation graph:

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

The server stores themes, manual ordering, investigations and the latest radar in ignored `.data/research.json` via atomic replacement. A restart preserves completed findings and records interrupted work explicitly. Completed real investigations can be reopened as recorded investigations. The public-source Browserbase fixture in `recordings/` makes the deep-research demonstration available in a fresh checkout without an API key. Theme recording validation accepts only genuine executions with five evidenced priced candidates; no such fixture is bundled yet. Live research can take several minutes, so prepare a real local theme before a three-minute presentation. Rechecks are on demand; no background monitoring is claimed.

## Environment

- `ANTHROPIC_API_KEY`: required only for live research; read by the server from `.env.local` or `.env`, never sent to the browser.
- `ANTHROPIC_MODEL`: defaults to `claude-sonnet-5-5`.
- `APP_ORIGIN`: optional exact HTTPS origin for a deployment behind a reverse proxy.
- `ANTHROPIC_COMMITTEE_MODEL`: optional stronger model for committee synthesis; the example selects `claude-opus-5-5`.
- `PORT`: defaults to `3001`.
- `HOST`: defaults to loopback `127.0.0.1`; use `0.0.0.0` only in a protected deployment.
- `MAX_INVESTIGATION_SECONDS`: defaults to 720; bounded at 30–1800.
- `MAX_INVESTIGATION_TOKENS`: defaults to 400,000 total input/output tokens, including research tool input.
- `MAX_RESEARCH_RUNS_PER_HOUR`: defaults to 20. At most two deep investigations run concurrently.
- `MAX_THEME_TOKENS`: defaults to 600,000 total input/output tokens across the theme comparison and bounded recovery work; capped at 800,000. Theme research has a ten-minute limit.

Search uses Anthropic's basic [`web_search_20250305`](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool), with per-agent search limits. The API organisation must have web search enabled. API errors, cancellation, partial findings, and missing credentials have explicit UI states.

## Deployment

This is a Node server application, not a static-only site. Use a persistent Node 22+ host with `npm ci && npm run build`, `npm start`, an environment-injected API key, and a durable volume mounted at `.data`. Protect any internet-facing deployment with your platform's access control to prevent unauthorised API spending. No external deployment is implied by a local build.

## Source integrity

Never commit `.env`, `.data`, credentials, or research access keys. Curated sample records use linked primary sources, explicitly labelled company claims and hypotheses, and unknown dates where publication dates are unavailable. Professional research is limited to public work history and corroborated identities. No private financial metrics are invented.

A disclosed financing valuation is a dated company-level reference, not an executable share quote, an available allocation or a current investment recommendation. The UI retains the financing date and pre/post-money basis, including an undisclosed basis. Access, share class, dilution, current terms and business performance need separate diligence. Source history measures recorded claim assessments and corrections, not a publisher's investment hit rate; no realised outcome dataset is present.

See [the three-minute demonstration](docs/DEMO.md).
