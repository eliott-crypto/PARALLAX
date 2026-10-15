# PARALLAX: real Claude investigation proof

**Final result: MONITOR · LOW confidence.** This retained Browserbase investigation completed nine agent roles, recorded **348,278 provider tokens**, and kept **28 evidence records across 22 distinct URLs**. It contains actual mistakes, a budget stop, corrections, and externally requested review.

[Download the upload ZIP](docs/submission/proof-upload.zip) · [Read the complete event log](docs/submission/run-proof.txt) · [Inspect the unchanged JSON](docs/submission/run-proof.json) · [Original repository recording](recordings/6b8771ef-7394-40b7-b702-222cbbad204f.json)

## What this proves

The team separated signal discovery, causal reasoning, company/founder/competitor research, advocacy, adversarial challenge, verification and assessment. Founder and competitive analysis ran in parallel; Bull and Bear ran in parallel. The Verifier used real search and the Bull revised its thesis after verification. Opening the saved proof replays retained data; it does not claim to launch live agents.

The strongest concrete correction is customer attribution. An early claim placed Salesforce and Visa among Browserbase customers. A fresh source review found those names in the **Sauce Labs competitor section** of the [Contrary report](https://research.contrary.com/company/browserbase). The original record `hunter-25db5414b0d8` was marked **CONTRADICTED**, with corrective evidence `verifier-challenge-13449d901849`. The final committee withdrew the claim.

Stagehand's official [account-free product description](https://www.browserbase.com/stagehand) weakened the proposed SDK lock-in mechanism. The final memo says **SDK-to-paid conversion, retention, realised margins and current ARR are unknown**. It omits unsupported download quantities, ARR estimates, valuation multiples and asserted margin compression. Historical messages remain visible so the correction is inspectable.

## Timing and human intervention

| Recorded field                 | Actual value                                  |
| ------------------------------ | --------------------------------------------- |
| Investigation/source ID        | `6b8771ef-7394-40b7-b702-222cbbad204f`        |
| Started (UTC)                  | 2026-10-15T11:37:55.875Z                      |
| Final completion (UTC)         | 2026-10-15T12:13:35.484Z                      |
| Elapsed wall clock             | 35m 39s (2139.609 seconds between timestamps) |
| Final committee provider model | `claude-opus-5-5`                             |
| Run-level model configuration  | `claude-sonnet-4-6`                           |
| Provider input / output tokens | 303,540 / 44,738                              |
| Recorded audit events          | 58                                            |

**The 35m 39s interval was not uninterrupted autonomous research.** The first committee attempt hit its token budget at 11:45:36 UTC. An explicit second verification challenge started at 12:01:37 UTC. External source-review notes requested further committee revisions at 12:08:08 and 12:13:01 UTC. The final Opus assessment finished at 12:13:35 UTC. Idle time, source auditing and resumptions are included in the wall clock.

Nine means completed **agent roles**, not nine total provider requests. The retained role counters include repeated verification, Bull revision and committee recovery. Earlier rows lack per-stage model fields; the run records Sonnet 4.6 configuration and the final committee explicitly records Opus 5.5. No missing model values have been filled in.

## Retained agent usage

| Agent                | Final status | Input tokens | Output tokens | Total tokens |       Recorded searches |
| -------------------- | ------------ | -----------: | ------------: | -----------: | ----------------------: |
| Scout                | completed    |        19233 |          3905 |        23138 |                       2 |
| Causal Analyst       | completed    |         3471 |          1430 |         4901 |                       0 |
| Company Hunter       | completed    |        34250 |          6456 |        40706 |                       2 |
| Founder Analyst      | completed    |        26425 |          4234 |        30659 |                       2 |
| Competitive Analyst  | completed    |        28320 |          3662 |        31982 |                       2 |
| Bull                 | completed    |        34248 |          8304 |        42552 |                       0 |
| Bear                 | completed    |        12463 |          1214 |        13677 |                       0 |
| Verifier             | completed    |        74304 |          5891 |        80195 |                       4 |
| Investment Committee | completed    |        70826 |          9642 |        80468 | not separately recorded |

The table reproduces stored counters. The counters sum to **303,540 input + 44,738 output = 348,278 tokens**. Agent timestamp fields were updated across revisions; they should not be read as continuous per-agent compute durations.

## Authoritative final assessment

> Browserbase remains a credible early research subject. The founder's professional history is well corroborated, and the customer-attribution correction is verified. The core thesis is unproven: no evidence shows that cheaper inference gives Browserbase a durable advantage over Steel or Browserless. Stagehand is MIT-licensed and needs no account. SDK-to-paid conversion, realised margins, retention and current ARR are unknown. Salesforce and Visa claims are withdrawn. Decision: MONITOR, pending targeted diligence.

The final committee asks for cohort conversion/retention, realised operating margins and customer-reference diligence. It makes no purchase recommendation or claim that Browserbase has a demonstrated durable moat.

## Verification and upload contents

The upload bundle contains `run-proof.json`, `run-proof.txt` and this `RUN-PROOF.md`. The JSON is a byte-identical copy of the repository's retained recording. The text log includes all 58 original event messages, timestamped and labelled historical; payload drafts are available unchanged in JSON. **Historical messages and payloads contain withdrawn or unsupported statements. The final committee and its external review notes supersede them.** In particular, the intermediate download reinterpretations are not accepted as final findings.

SHA-256 of `run-proof.json` (also the original recording):

```text
3d8e887414f6bdb5caadc85695a2b51928bd8ae9d0a3809f7a4fbfeebc142d98
```

Verification: compare the JSON hash, sum the agent counters, count the nine completed roles, inspect all 58 events, and follow the source IDs in the final committee. The plaintext source index lists all 28 evidence IDs and their URLs. This proof describes this specific completed run; it does not imply every research run completes successfully or every historical generated claim was correct.
