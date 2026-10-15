# Architecture

The repository is the source of truth. The Vite React client and Express research service share Zod schemas in `shared/types.ts`. Runtime state lives on the server. A successful live run is never substituted with editorial sample data.

## Research execution

Each specialist has an independent Claude context and validated structured output. Scout → causal analysis → company discovery run sequentially. Founder and competitive research run concurrently, then Bull and Bear independently read shared evidence. Verifier performs follow-up research on a material objection. The Bull receives the verification outcome and revises its position before the committee synthesises the assessment. The loop is capped.

Admitted evidence must trace its URL to Anthropic search-result or citation blocks, or an already admitted source. Rejected citations cannot support factual findings. This validates provenance, not the truth of every model interpretation: source relevance and claim support remain research judgments and are shown with qualitative confidence, claim types, unresolved questions, and verification outcomes.

Public professional records may establish a founder's professional history. Missing history never implies misconduct. Company assertions remain first-party claims, and causal implications remain hypotheses unless supported by evidence.

## State and reliability

An investigation is an append-only activity trail plus current agent state and evidence. SSE publishes full snapshots so reconnecting clients recover without stitching partial deltas. On-disk atomic replacement provides single-process persistence. Running research is marked partial after a process restart. Live runs have cancellation, request timeouts, per-agent search budgets, total token budgeting and bounded retry/continuation.

The repository includes a separately labelled curated research sample. It has zero model tokens, no fabricated activity events, and no claim to be a historical Claude execution. Actual completed live runs are persisted and can be reopened as recorded investigations.

Watchtower stores a thesis and rechecks it only when requested. There is no background scheduler.

## Boundaries

The default server binds loopback. API keys are read only by the server and excluded from Git and Docker context. Never publish an unprotected research endpoint with a funded API key. For a hosted demonstration, use platform access protection plus a persistent `.data` volume. The file store targets one Node process; multiple replicas require a transactional shared database and distributed job queue.
