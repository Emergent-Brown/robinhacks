# Platform, cost, and operating limits

> **Historical version-one document (September 8–10, 2026).** This trading proposal/implementation record is preserved for context. [11 · Sealed funding rounds](11-sealed-rounds.md) supersedes its current product rules, lifecycle and architecture. Do not use the old buy/sell instructions for a version-two event.

Status: proposal, checked against official documentation on **September 8, 2026**. No Firebase project or database has been selected or provisioned. Usage figures below are planning calculations, not measured results.

## Recommendation

Use a static React/TypeScript mobile web app on **Firebase Hosting**, Firebase Authentication, **Firestore Standard edition**, and a small set of second-generation callable Cloud Functions on **Blaze**. Keep the game engine in ordinary TypeScript behind repository interfaces so it can run in tests, the emulator, or a different trusted server.

This fits the organizer's preference: attach billing, aim for a $0 bill, tightly limit normal event usage. It cannot guarantee a $0 bill. The largest predictable risk at this scale is repeatedly distributing changing documents to every spectator, rather than storing the game itself.

| Choice | Decision and reason |
| --- | --- |
| Firestore edition | Propose Standard with Core operations: the game needs document transactions, small queries, and listeners. Enterprise's Pipeline/MongoDB capabilities add no identified requirement. Confirm the actual edition before implementation; the quotas in this document are for Standard. |
| Database | One `(default)` database in a dedicated production project. Use emulators for development and a separate staging project when production-like verification is needed. |
| Region | Choose one regional location near the venue and co-locate functions. `us-west1` is a reasonable candidate for a California event; confirm the venue before creating resources. |
| Hosting | Classic Firebase Hosting serves the static application. Server rendering offers little benefit for a private event app. |
| Backend | Callable functions authorize commands, execute transactions, enforce phase deadlines, and return receipts. No browser can directly mutate balances, pools, positions, or ledger records. |
| Scheduling | Manual phase changes with server deadline checks. A small projection worker may publish market snapshots while an organizer has the event console open; no paid scheduler is necessary for correctness. |
| Media | Text, initials, and bundled event artwork for the first event. Link to demos instead of uploading videos. |

Regional placement reduces network distance and can lower cost compared with multi-region placement. Co-location is a design choice to make after confirming the venue. [Firestore deployment guidance](https://firebase.google.com/docs/firestore/best-practices)

Callable requests carry available Auth and App Check tokens and validate authentication tokens, but application code still has to reject missing authentication and enforce membership, role, and game rules. [Callable functions](https://firebase.google.com/docs/functions/callable)

App Hosting requires Blaze and brings Cloud Run, build, artifact, logging, and related billing dimensions. It is useful for server-rendered applications; that extra runtime is unnecessary for this proposal. [App Hosting costs](https://firebase.google.com/docs/app-hosting/costs)

## What “free” means

| Mode | What it provides | Limitation |
| --- | --- | --- |
| Local emulator | Full local development without deployed production infrastructure | Does not provide a public event service or establish production capacity. |
| Spark with no billing account | Static hosting, eligible Auth providers, and limited Firestore usage | Cloud Functions cannot be deployed. A trusted local operator could settle a simpler batch game, but organizer availability becomes part of the backend. |
| Blaze, recommended | Managed trusted functions plus no-cost usage allowances | Overage, build artifacts, network traffic, and optional services can create charges. |

Functions can be emulated without Blaze; deploying them requires Blaze. Moving the trading authority into browser writes just to avoid this requirement would make validation and maintenance substantially harder. [Functions deployment requirements](https://firebase.google.com/docs/functions/get-started)

Do not describe introductory credits as free operation. The proposal should remain economical after any credit expires.

The current Standard allowance is **50,000 document reads/day, 20,000 writes/day, 20,000 deletes/day, 1 GiB stored, and 10 GiB outbound/month**. Daily operations reset around midnight Pacific, independently of the event's local date. Only one database per project receives the free allowance. TTL deletion, backups, PITR, restore, and clone usage are outside the free allowance. [Firestore quotas](https://firebase.google.com/docs/firestore/quotas)

### Hosting and uploads

The official pages currently disagree on the presentation of Hosting transfer limits: the pricing table lists **360 MB/day**, while the detailed Hosting page describes **10 GB/month** and monthly Spark suspension behavior. Treat 360 MB on event day as a conservative planning target and check the actual console before launch. Both list 10 GB of Hosting storage. [Firebase pricing](https://firebase.google.com/pricing), [Hosting usage and quotas](https://firebase.google.com/docs/hosting/usage-quotas-pricing)

Illustrative transfer: 150 participants × 2 cold downloads × 0.75 MB compressed assets = **225 MB**. If each cold download is 2 MB, that becomes **600 MB**. Include fonts and images in the measurement, use fingerprinted browser caching, and avoid a large video background. A CDN cache hit still transfers bytes to the user.

Cloud Storage for Firebase now requires Blaze, including existing default buckets; this requirement took effect February 3, 2026. New buckets use Google Cloud Storage pricing, with location-dependent no-cost allowances. Storage is optional here, so defer it until image uploads have a clear product need. [Storage billing requirements](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024)

## Event-day capacity model

Model the upper end of the expected roster: **30 teams, 150 participants, three 30-minute trading windows**, and a separate seed phase during one Firestore quota day. The selected game permits 15 successful secondary trades/team/window: **30 × 15 × 3 = 1,350 maximum successful secondary trades**, with a 10-second successful-trade wallet cooldown. The baseline assumes **100 average connected market viewers**, since hidden views unsubscribe; the all-150-connected case is calculated separately. This is an explicit viewing assumption, not a capacity limit. The seed phase, revisions, retries, canceled requests, and administrative work must also be counted.

The ledger design should be measured against **8 reads and 8 writes per successful trade**. The current architecture has four core atomic writes: wallet with cooldown/counter, position, pool, and immutable receipt with embedded balanced journal entries. Eight writes is a conservative envelope for the completed flow, not a requirement to duplicate those records. If the final implementation needs 10 writes, 2,000 fills consume the entire 20,000-write allowance before setup or settlement.

### Reads

| Source | Explicit assumption | Reads |
| --- | --- | ---: |
| Authoritative trade transactions | 1,350 × 8 document reads | 10,800 |
| Opening trade sheets | One pool + one membership-rule read per successful trade | 2,700 |
| Public market updates | 45 two-minute publications + 6 phase publications, × 100 average viewers | 5,100 |
| Market membership rules | One current-membership dependency for every snapshot delivery | 5,100 |
| Building snapshots | 30 pools + 30 team summaries, × 51 publications | 3,060 |
| Publisher control | 10 reads/publication allowance for authorization, gate, lease, and prior view | 510 |
| Opening shared portfolios | 150 people × 2 entries × (wallet + 10 average positions + 2 membership dependencies) | 3,900 |
| Private trade updates | Wallet + changed position, one active portfolio listener per team | 2,700 |
| Private rule dependencies | Allow one membership dependency per private document update | 2,700 |
| Event state | 8 state deliveries × 150 people × (event + membership dependency) | 2,400 |
| Team details | 4 detailed project views × 150 people × (team + membership dependency) | 1,200 |
| Initial/reconnected market views | 2 attaches × 150 people × (snapshot + membership dependency) | 600 |
| Transaction retry reserve | 10% of transaction reads | 1,080 |
| Seed, finalization, admin | Preliminary allowance; instrument the completed flows | 4,000 |
| **Planning total** | **4,150 reads below the allowance** | **45,850** |

All event read rules use the caller's **current approved membership**, including public-safe market and pool records. This avoids a separate custom-claim access policy and gives membership changes effect on subsequent access checks. The table counts those rule reads. The catalog is bundled into `views/market`; clients do not separately fetch all 30 team profiles just to render Explore.

The private-view assumption is one active trading view per team; other members open portfolios on demand. If all five members keep live private listeners, private document updates alone rise from 2,700 to 13,500 reads, before additional rule reads. If every portfolio open returns 29 positions instead of ten, the two-entry portfolio allowance increases by 5,700 reads. Two simultaneous authorized traders and multiple tabs also change the model; the game permissions do not guarantee one listener.

With **all 150 people watching every publication**, the selected 1,350-trade case becomes **50,950 reads**, slightly above the daily allowance. An otherwise identical **2,000-successful-trade stress case** is **55,470 reads** with 100 average market viewers, or **60,570** with all 150 connected. Opening sheets without submitting, rejected requests, additional phase changes, reconnects, and extra page entries can increase these figures further. A $0 result is possible under the baseline; dependable game behavior takes priority over avoiding a tiny overage.

The compact snapshot is a display projection, never the execution authority. Entering a trade sheet fetches the pool once and uses the shared pure pricing function locally. The server recalculates execution with current pool state, expected versions, and a user-approved debit/credit bound. Show the snapshot update time so a two-minute-old market screen does not imply an executable price. No separate quote RPC is required. Private Estimated liquidation value uses the public reserve quantities in that displayed snapshot; fetching fresh reserves for every holding would be an additional read workload.

Firestore bills changed documents delivered to listeners; each reconnect can also cause a new query, depending on persistence and disconnection duration. Rules using `get`, `exists`, or `getAfter` can add reads. Queries with multiple range fields can incur index-entry reads; empty queries still have a minimum read charge. Use pagination cursors instead of offsets. [Firestore billing details](https://firebase.google.com/docs/firestore/pricing)

Two expensive alternatives illustrate why view design matters:

- Broadcasting every one of 2,000 fills to 150 listeners produces **300,000 reads**, before any wallet, rule, or server activity.
- Polling all 30 pool documents every minute for 150 people produces **405,000 document reads** during the 90 trading minutes, before membership dependencies. Forty-five compact two-minute snapshots produce 6,750 document reads at the same audience, plus 6,750 membership-rule reads; phase-boundary updates are additional.

**Closed markets must not keep polling the database.** One snapshot poll/minute × 150 people × 8 closed hours adds **72,000 document reads**, plus membership-rule reads, despite no trades. Retain an event-state listener for phase changes, read a final market snapshot, stop periodic refreshes, and detach hidden-screen listeners. A static snapshot listener does not bill an unchanged document every minute, though reconnects still matter.

Publish funding standings after seed settlement and final investment standings after judging. There are no interim public investment rankings and no periodic whole-event portfolio scan. Inspect seed processing, finalization, history, and admin queries against the 4,000-read lifecycle allowance during rehearsal; increase the estimate if needed. The foreground organizer panel requests publications keyed to the current phase and a server-derived two-minute slot. Expiring ownership and fencing checks prevent a failed claim from stranding a slot or an older worker overwriting a later phase. If the panel closes, the last snapshot remains usable and trading correctness is unaffected.

### Writes and storage

| Source | Assumption | Writes |
| --- | --- | ---: |
| Trading | 1,350 × 8 writes | 10,800 |
| Seed, teams, memberships, finalization, admin | Preliminary allowance | 4,000 |
| Market publication | 51 publications × (lease claim + snapshot + completed marker) | 153 |
| **Planning total** | **5,047 writes below the allowance** | **14,953** |

At 10 writes/trade, the selected-limit model becomes **17,653 writes**. The 2,000-successful-trade stress case is **20,153 writes** at eight writes/trade, or **24,153** at ten. Transaction retry reads, duplicate-command lookups, rejected-request throttle writes, administrative edits, and load-test traffic must be counted where they actually occur. In particular, accepted-trade limits do not bound the number of writes to `requestLimits/{uid}`. Free quota is shared across every event in the same project on that quota day.

The issuer record combines `fundingVaultMinor` and `primarySharesRemaining`. A maximum seed unit therefore writes 29 positions + 29 issuer records + wallet + receipt + completed-unit record = **61 documents**, or at most **1,830 writes across 30 teams**, before separate progress bookkeeping. The 4,000-write lifecycle allowance also covers genesis, memberships, commitments, profile/admin activity, and result records. For example, ten accepted seed-sheet revisions per team at three writes each would add 900 writes; count endpoint throttles separately where used. Final scoring writes report records from frozen state; it does not mint credits or retire shares.

A rough storage envelope of 20,000 retained documents × 2 KiB each is approximately **39 MiB before indexes and metadata**. This is comfortably below 1 GiB as a design estimate; it is not a reason to put unlimited text or embedded history arrays into records. Exempt large non-query fields and projection maps from indexing, and commit required composite indexes with the code. [Index and transaction guidance](https://firebase.google.com/docs/firestore/best-practices)

For perspective, the currently displayed `us-central1` Standard rates are $0.03/100,000 reads and $0.09/100,000 writes above the daily allowance. An extra 15,000 reads plus 1,090 writes would therefore be roughly **$0.0055 in database operations**, excluding other services and rounding. This is an illustrative regional calculation, not a bill estimate for the eventual deployment location. [Firestore regional pricing](https://cloud.google.com/firestore/pricing)

### Compute

Allow more invocations than completed trades: rejected commands, seed changes, projection refresh requests, and admin actions also execute code. An illustrative 10,000 invocations × 1 second × 1 vCPU uses 10,000 vCPU-seconds; at 256 MiB it uses 2,500 GiB-seconds. Cold starts and other billed execution add to this.

For request-based Cloud Run billing, the monthly allowance includes 2 million requests, 180,000 vCPU-seconds, and 360,000 GiB-seconds; usage is subject to pricing location and billing-account aggregation. Use the deployed function generation and configuration when calculating, rather than mixing first-generation Functions numbers with second-generation compute. [Cloud Run pricing](https://cloud.google.com/run/pricing)

## Authentication and access controls

Use **Google sign-in with email/password fallback**. Membership requires a roster or controlled invite; possessing an account does not grant a funded team or an organizer role. Avoid anonymous funded accounts and phone authentication for the first event.

Firebase-sent email sign-in links are limited to 5/day on Spark and 25,000/day on Blaze. Email/password and Google are a simpler common flow across environments. Account creation has a documented 100 accounts/hour/IP limit, which matters when 150 people share venue Wi-Fi: invite people to sign in beforehand and rehearse the arrival flow. A temporary quota increase can be arranged where needed. [Authentication limits](https://firebase.google.com/docs/auth/limits)

Deploy deny-by-default Firestore rules, explicitly permit public-safe reads, and permit private reads only for appropriate members. Deny all client writes to authoritative financial state. Server SDKs bypass Firestore rules, so the function's service account needs deliberate IAM permissions and every command must perform authorization itself. Never put a service-account key in the client bundle. [Firestore server access and IAM](https://firebase.google.com/docs/firestore/security/insecure-rules)

Use App Check for callable and Firestore abuse resistance after testing real participant browsers. It complements authentication; it does not establish team membership, prevent a legitimate participant from scripting requests, or guarantee zero abuse. The web reCAPTCHA Enterprise provider has 10,000 no-cost assessments/month and charges beyond that, so monitor attestation usage and token refresh behavior too. Keep debug tokens confined to development. [App Check](https://firebase.google.com/docs/app-check)

## Operating controls

1. **Instrument a full rehearsal.** Record reads/writes per command, transaction retries, number of active listeners, projection size, cold-start latency, and failed/duplicate requests. The local emulator verifies correctness; use a small staging run to observe production behavior and billing metrics.
2. **Bound the game.** Enforce the selected 15 successful trades/team/window, 10-second successful-trade cooldown, roster limits, order limits, and trading deadlines. Keep failed-request rate limiting separate: accepted-trade limits do not stop invocation abuse. Rehearse the full 1,350-successful-trade event and also the 2,000-trade stress scenario.
3. **Keep function scaling small.** Start at `minInstances: 0` and a low tested `maxInstances`, with short command timeouts. Limits constrain throughput rather than create a financial cap; overload must return a retryable result without double execution. Configure artifact cleanup so repeated deployments do not accumulate container storage. [Function lifecycle and scaling](https://firebase.google.com/docs/functions/manage-functions)
4. **Keep the cost controls separate from game controls.** An emergency read-only mode rejects new trade commands and stops projection work. It does not stop every Firebase product from serving requests. Do not call it a billing kill switch.
5. **Configure billing visibility.** Use an alerts-only budget with early thresholds and an organizer who receives it. Such a budget sends notifications; it does not stop spending. [Budget alerts](https://docs.cloud.google.com/billing/docs/how-to/budgets)
6. **Evaluate the current compute spend-cap preview.** Google now offers service-scoped spend caps for Cloud Run and Cloud Run functions, among other eligible services. Firestore and Firebase Hosting are absent from the current eligible list. Caps are delayed by reporting, allow in-flight usage to finish, and still bill overages. They can limit compute exposure but cannot guarantee the entire app costs $0. [Spend-cap scope and limitations](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps)
7. **Close the event cleanly.** Publish final results, disable trading and registration, stop projection refreshes, export the ledger through a deliberate operator command, and remove unneeded deployments after the retention period. Managed backups or TTL cleanup are separate billable choices, not assumed free features.

The proposed stack needs no additional database or hosting provider for this event. Keep the domain engine portable, but adding a second provider now would increase account setup, deployment paths, and failure modes without resolving a demonstrated requirement.
