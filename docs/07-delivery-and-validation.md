# Delivery and validation plan

Status: build plan, not completed implementation. The workspace currently contains documentation only. Commands below are the proposed developer experience to implement, not scripts that already exist.

## Build one playable event before expanding

Implement vertical slices that connect a real screen to real authorization and persisted state. Complete the ledger and phase boundaries before polishing market charts. Keep the pure domain portable, but ship one backend and one deployment path.

| Milestone | Deliverable | Evidence needed to move on |
|---|---|---|
| 0. Rules rehearsal | Play through seed, trades, pause, and judged finish with 5–10 people using a small simulation | Participants can explain pricing, locked funding, final scoring, and shared wallet; review reserve depth and pacing |
| 1. Local foundation | Typed workspace, emulator configuration, fixtures, shell, sign-in, membership, event rules | One command starts a seeded local event; unauthorized users cannot claim teams or write state |
| 2. Complete trade slice | One project → exact preview → confirmed atomic trade → receipt → portfolio | Duplicate, concurrency, stale quote, own-team ban, and closed-market tests pass |
| 3. Seed funding | Private editable sheet, reservations, pro-rata manifest, resumable team settlement, simultaneous reveal | Oversubscribed allocations conserve shares/credits and recover from a stopped job |
| 4. Event controls | Approved roster, frozen settings, three windows, pause, issuer halt, profile updates | Organizer can run the schedule on a phone; deadlines fail closed without a running timer |
| 5. Results and records | Judge input validation, payout preview, immutable final result, portfolio notes, CSV/JSON exports | Repeated finalization produces one result; reconciled exports explain each balance and final score |
| 6. Pilot release | Mobile/accessibility rehearsal, measured staging usage, incident drill, production configuration | All release gates below pass with recorded evidence |

Make the first end-to-end demo small: three fixture teams, one open window, one valid buy, one rejected self-buy, one pause, and one receipt recovered after simulated timeout. Once that is correct, extend to the 30-team configuration. A beautiful fixture-only dashboard is not a playable milestone.

## Local development contract

The implementation should provide:

```text
npm ci                 install pinned workspace dependencies
npm run dev            start web + Auth/Firestore/Functions emulators
npm run seed           load deterministic local teams, roles, pools, windows
npm run check          typecheck + lint + appropriate tests
npm run test:domain    invariant and allocation tests without Firebase
npm run test:emulator  authorization and atomic command integration tests
npm run test:e2e       essential participant and organizer browser journeys
npm run build          build static client + functions
npm run reconcile     read-only validation of a selected local/exported event
```

Fail startup if required emulator ports are unavailable; do not quietly fall back to production. Use a clearly marked `demo-` project ID locally. A visible `Local demo` indicator and deterministic fake credentials prevent mistaking fixtures for the event.

Document the supported Node version, Java/runtime requirements for selected emulators, and first-run setup when dependencies are pinned. Use a single bootstrap path for new contributors, keep environment templates free of secrets, and explain exactly which configuration values are public browser identifiers.

Seed commands must refuse a production project by default and require an explicit production-safe bootstrap command for real initial state. No universal “reset database” script that can accidentally target the live event.

## Tests that protect the game

### Pure domain and economic tests

Test conservation, not just examples. Generate bounded random valid reserves and portfolios, then check nonnegative cash, fixed issuer supply, holding caps, exact rounded transfers, and no profit from an isolated immediate round trip. Check oversized numeric input and integer overflow boundaries before serialization.

Test primary allocation with all-zero requests, everyone requesting one stock, tied remainders, insufficient requests, a withdrawn issuer, and repeated application of the same manifest. Each allocation must be no larger than its request; allocation totals must match capacity; reservations must clear precisely.

Test rank-based final values with one eligible issuer, two issuers, tied first, all tied, disqualification, missing/conflicted judge scores, fractional score ties, and cent rounding. Confirm that changing a final pool price does not alter a frozen final portfolio score.

### Emulator integration tests

Exercise the real callable application services and Firestore adapter:

- Two traders spend one wallet simultaneously; only a valid serialized outcome is accepted.
- Different wallets buy from one pool simultaneously; stale previews reject and supply is conserved.
- Repeated identical IDs return the first receipt; altered payloads conflict.
- A response is lost after commit; receipt recovery after market close succeeds.
- Close, pause, membership suspension, and issuer halt race an attempted trade.
- A transaction retries across the deadline; refreshed server time rejects it.
- Funding stops halfway through processing teams and resumes without duplicate debits or partial public reveal.
- Finalization stops halfway through result creation and resumes without publishing mixed versions.
- An older projection worker completes after a close snapshot and cannot overwrite it.
- A participant, pending applicant, removed member, and nontrading teammate exercise every relevant read/write boundary.

Never rely only on Admin SDK tests for Firestore read rules. Test browser-like authenticated rule access separately, including cross-team reads and direct writes to every authoritative collection. Firebase documents emulator-based rule testing as a dedicated workflow. [Security Rules unit testing](https://firebase.google.com/docs/rules/unit-tests).

### Browser and usability tests

Use mobile widths of 360 and 390 pixels and a typical desktop viewport. Verify the essential flow on actual iOS Safari and Android Chrome before the event, not merely a resized desktop viewport. Test keyboard navigation, focus return from sheets, screen-reader labels, zoom, long project names, decimal amounts, safe-area insets, and a visible on-screen keyboard.

Exercise slow responses, offline navigation, session expiry, hidden/background tabs, two open tabs, rejected quotes, and an uncertain trade outcome. No optimistic financial mutation may appear as confirmed. Reading cached data is fine when clearly labeled; financial commands are never queued for later offline replay.

Invite five people who did not build the app to complete: join a team, explain the shared wallet, request seed shares, interpret a partial allocation, buy, sell, find the receipt, and explain final scoring. Observe where they hesitate before adding explanatory copy everywhere.

## Capacity and cost rehearsal

The theoretical cap is 30 teams × 15 successful trades × 3 windows = 1,350 successful secondary trades. Rehearse that event locally for correctness, then run a **bounded** staging sample for latency, contention, listener behavior, and billing visibility. Do not generate full-event production traffic simply to verify arithmetic.

Simulate dispersed investments, highly concentrated buying, low participation, simultaneous window opening, many quote changes, and intentional reciprocal trading. Use deterministic random seeds and retain inputs/results so tuning is reproducible. Test 10-, 20-, and 30-team populations. An arithmetic sanity check is not evidence that people will enjoy the market.

Measure successful/rejected command reads and writes, rule-dependent reads, portfolio openings per member, quote previews that never submit, active listeners, projection publications, request throttling, function cold starts, and browser transfer size. Compare against [the cost model](06-cost-and-platform.md). If usage misses the budget, change the limits/cadence **before** rules freeze or explicitly accept the measured small charge; do not secretly ration trades mid-event.

## Release gates

- The rules and code agree on all parameters, rounding, custody, final valuation, and every legal phase transition.
- Ledger reconciliation passes after seed settlement, each trading window, a recovery drill, and final results.
- Integration tests prove role checks, idempotency, deadline behavior, atomicity, and private-data isolation.
- Mobile users can complete the core flow without clipped controls or horizontal page scrolling.
- Organizers have rehearsed account approval, pause, resume, a stopped settlement, and result correction.
- Auth works on the venue network; participants are encouraged to sign in beforehand.
- Production rules, indexes, callable authorization, App Check, IAM, scaling bounds, logging, and budget notifications are reviewed.
- A cold-start and opening-burst rehearsal meets agreed response targets. Initial targets: a quote loads within two seconds on venue Wi-Fi; a normal confirmed trade responds within three seconds, with an honest pending state when slower.
- Measured usage fits an acknowledged operating budget. $0 is a target, not a contractual or technical guarantee.
- A checkpoint export has been reconciled in isolation, and an operator knows the recovery steps.

## Decisions recorded

| Decision | Reason | Revisit when |
|---|---|---|
| Equal shared team wallets | Headcount must not buy investment power | A future event explicitly wants an individual game |
| Sealed fixed-price seed + exchange pools | Fair opening access and immediate subsequent trades | Real usage demonstrates demand for order-book behavior |
| Locked project funding | Prevent fundraising from funding reciprocal investments | Designing a distinct resource-allocation game |
| Final values from independent judging | Final market pumping must not define the result | Choosing a different explicitly defined outcome source |
| Final-only investor standings | Live marks can encourage price chasing and imply false certainty | A measured participant need justifies another carefully labeled metric |
| Static React/Vite client | Event app needs no server-rendered content | Public discovery/SEO becomes a core requirement |
| Firestore Standard + callable functions | Atomic commands and familiar managed operations | Proven contention or query requirements exceed this model |
| Modules within one system | Easy local setup and one deployable backend | Actual organizational or scale boundaries justify services |
| Two-minute market projections | Keep membership-aware reads within a small-event budget | Measured usage permits faster updates or users require them |
| No required background scheduler | Deadlines and correctness do not depend on a paid/always-on job | Organizers need unattended settlement/projection processing |
| Final results are immutable score reports | Preserve the frozen trading ledger without inventing payout cash | A future post-event spendable game economy is intentionally designed |

## Remaining event decisions

These do not block implementation planning, but the organizer must resolve them before the pilot:

1. Exact venue/time zone, event length, and checkpoint schedule.
2. Judges and rubric, conflict handling, and whether investment recognition is purely symbolic.
3. Final event name, typography/brand assets, and supported sign-in providers.
4. Approved roster and who can act as captain/trader for each team.
5. Data retention period and who may download private event exports.

Do not ask the user to decide low-level folder names, library wiring, or database field naming. Those are routine implementation choices within this blueprint.
