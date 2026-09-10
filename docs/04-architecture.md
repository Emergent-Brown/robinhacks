# Architecture

Status: proposed architecture for the first event; no services have been provisioned and no application code exists yet.

## Recommended system

Use a **TypeScript modular monolith**: a React/Vite static web client, Firebase Authentication, Firestore Standard edition, and a small set of callable Cloud Functions. Deploy the client to classic Firebase Hosting. Develop against the Firebase Emulator Suite.

The database edition is a design recommendation, not a claim about an existing instance: the workspace was empty and contains no Firebase project binding. Explicitly choose and verify Standard edition during implementation; revisit this decision only if requirements actually need Enterprise capabilities. Do not provision a database as a side effect of documentation work.

The product does not need server-side rendered pages, a permanent server, a second database, Redis, a queue broker, GraphQL, or separate deployable services. Its data is small and its critical operation is a short atomic trade.

Vite is suited to a static client build; Firebase callable functions provide the server entry point with Firebase token integration. Authentication is still only identity: every command must explicitly authorize the caller for the requested event and team. [Vite guide](https://vite.dev/guide/), [Firebase callable functions](https://firebase.google.com/docs/functions/callable).

```text
Phone / laptop
  React views and feature controllers
    ├── query adapters ────────> participant-safe Firestore read models
    └── command adapters ──────> callable function handlers
                                  │ validate + authorize
                                  v
                             application services
                                  │ orchestrate a unit of work
                                  v
                             pure domain policies
                                  │ validated state transition
                                  v
                             Firestore transaction
                               wallet + position + pool + receipt

Organizer console ──────────> same command boundary, stronger permissions
Exports / standings <─────── immutable receipts and bounded read projections
```

## Boundaries that make maintenance easy

| Module | Owns | Must not own |
|---|---|---|
| Identity & membership | Event membership, team roles, approval, suspension | Pricing or account balances |
| Event lifecycle | Rule version, roster freeze, windows, pause, finalization gates | UI countdown behavior |
| Teams | Public project data, checkpoint updates, eligibility | Market-price calculations |
| Funding | Commitments, reservation, allocation manifest, seed settlement | Secondary trading |
| Exchange | Pool inventory, preview math, quote validation, buy/sell transitions | Authentication SDK details |
| Portfolio | Wallets, positions, cost basis, private notes | Independent judge scores |
| Results | Judge-score validation, payout manifest, final portfolio results | Historical price mutation |
| Reporting | Market snapshots, backing totals, receipts, exports | Authoritative financial state |

Dependencies point inward: handlers → application services → domain. Infrastructure implements interfaces consumed by application services. React imports contract types and pure preview calculations, never Admin SDK or server repositories. Modules call explicit application interfaces; they do not reach into each other's storage collections casually.

## Object orientation without a framework maze

Use small classes where a class protects invariants or coordinates a dependency:

- `Credits` validates integer hundredths, addition/subtraction, bounds, and serialization.
- `ShareQuantity` admits bounded, nonnegative whole shares.
- `ConstantProductPool` returns a buy/sell transition and refuses insufficient inventory or invalid quantities.
- `EventPolicy` determines which commands are allowed under a phase, window, pause, and server time.
- `FundingAllocation` computes a deterministic allocation from frozen commitments.
- `TradeService` loads state through a unit of work, applies policies, and persists the result once.
- `FinalizeResultsService` validates inputs and resumes a staged, idempotent settlement.

Use immutable records for DTOs and receipts. Pure functions are appropriate for sorting, pro-rata remainder allocation, and rank-based payout calculation. React components remain ordinary function components.

Prefer composition and explicit constructor injection. Do not introduce a universal `BaseEntity`, deeply inherited services, runtime dependency injection container, generic repository framework, or a class per table. The benefit comes from visible boundaries and invariant enforcement, not a class count.

Illustrative interface contract, not implementation:

```ts
interface TradingUnitOfWork {
  run<T>(work: (tx: TradingTransaction) => Promise<T>): Promise<T>;
}

interface TradingTransaction {
  loadTradeState(command: ExecuteTrade): Promise<TradeState>;
  commitTrade(transition: TradeTransition): void;
}

class TradeService {
  constructor(
    private readonly unitOfWork: TradingUnitOfWork,
    private readonly clock: Clock,
  ) {}
  // execute validates access, finds an existing receipt, checks the phase,
  // derives a transition from domain objects, then commits it atomically.
}
```

The unit of work must use one real Firestore transaction for the full transition. Individual repository methods that each commit independently would defeat the architecture.

## Proposed repository shape

```text
apps/
  web/src/
    app/                   routing, providers, accessible shell
    features/
      explore/ team/ funding/ trading/ portfolio/ standings/ admin/
    adapters/firebase/     browser reads and callable transports
    ui/                    reusable visual primitives
  functions/src/
    handlers/              small callable adapters
    application/           use cases and authorization
    infrastructure/        Admin SDK, transactions, export adapters
    bootstrap/             explicit dependency construction
packages/
  domain/src/              pure policies, value objects, simulations
  contracts/src/           runtime schemas, DTOs, error codes
firebase/
  firestore.rules
  firestore.indexes.json
scripts/                   seed, reconcile, snapshot, export helpers
tests/
  integration/             Emulator-backed rules and command tests
  e2e/                     essential mobile participant/admin journeys
docs/                      this blueprint
```

Use one npm workspace and lockfile. A conventional folder module is enough; do not make each feature a published package. Shared contracts and the pure domain are the two package boundaries with clear value. Pin supported runtime/dependency versions when building, rather than pretending the documentation has installed them.

## Trade execution

1. The trade sheet reads the latest participant-readable pool and the team's current wallet/position. Shared pure math produces an exact preview with price impact and remaining credits.
2. The user confirms whole shares, side, total, and shared team wallet. The client sends a command ID, expected phase/pool/wallet versions, and maximum debit or minimum credit.
3. The callable handler validates the runtime schema and authenticated identity, and requires App Check in the deployed configuration after a venue rehearsal.
4. Inside a transaction, read the event gate, membership, issuer eligibility, wallet, position, pool, and existing receipt. Validate event/team scope, trader role, suspension, own-team ban, cooldown, per-window allowance, balances, quantity cap, and expected versions.
5. Recompute the price on the server. If any expected version or price bound fails, return a typed error requiring another review. Never automatically accept a worse quote.
6. Atomically update **wallet, position, pool, and one immutable receipt containing balanced journal entries**. The wallet also stores the successful-trade cooldown and window count, avoiding a separate counter write.
7. Return the persisted receipt. The client renders success from the receipt, not from an animation or optimistic balance update.

A preview is not trusted financial authority. Its ten-second client expiry is a usability choice; safety comes from current server state, exact versions, price bounds, and authorization. There is no need for a stored quote document or a signing secret for this scheme.

Firestore transactions can rerun their callback. Generate stable IDs outside the callback, read before writing, and perform no email, external call, file creation, or projection write outside the transaction from inside that callback. [Transaction behavior](https://firebase.google.com/docs/firestore/manage-data/transactions).

### Retry and duplicate semantics

Command IDs are scoped to event and wallet. Store a canonical payload hash in the receipt. An identical retry returns the same receipt; reuse with different economic inputs returns `COMMAND_CONFLICT`. Do not hash the current access token or other request metadata.

Authorize receipt access before returning an existing result. Then check for an existing accepted receipt before rejecting on the current phase: a successful trade whose response was lost must still be recoverable after trading closes.

Rejected commands do not consume the successful-trade allowance. Retry throttling at the endpoint prevents cheap rejection loops from becoming unlimited backend work. A timeout is an unknown outcome: look up the same receipt or retry the same command ID. Never create a new ID because the network timed out.

## Phase gates and concurrency

All state-changing market commands read a small event gate. Admin transitions update that same gate transactionally with the expected version. This gives close/pause actions a consistent ordering relative to trades. A trade already serialized before a manual close may finish; a trade serialized after it must fail. [Firestore transaction isolation](https://firebase.google.com/docs/firestore/transaction-data-contention).

The server reads its clock after loading transaction state and checks the scheduled deadline immediately before deriving the transition, on every attempt including retried callbacks. Define the cutoff as **server validation/admission time**, not a promise of exact commit time: a request validated just before the deadline may acknowledge just after it. Browser timestamps and countdowns never authorize an action.

Automatic opening is not required. A configured end time rejects late trades even if the organizer leaves the console or no timer runs. The client derives “closed” from that end time while the stored lifecycle may await the organizer's next transition. A separate pause overlay blocks newly admitted commitments/trades after the pause commits, without changing the underlying phase or erasing deadlines; resuming after expiry does not extend a window.

The event gate is intentionally shared at this small scale. It is read per trade, not updated per trade. A hot issuer pool can still cause contention; handle retry exhaustion and test the opening burst. Do not shard a pool's balances to conceal contention and lose atomic pricing.

## Funding and final results are resumable jobs

A whole event settlement is too large to pretend it is one transaction. Use explicit lifecycle states and deterministic checkpoints:

1. Close the relevant market phase and persist an immutable input manifest tied to the rule version, roster, and source versions.
2. Process small, repeatable units with stable operation IDs. A seed unit is one team's complete settlement: credit debit/release, positions, transfers to issuer vaults, and receipt are atomic. At most 29 issuers participate for a 30-team event. Each `issuers/{issuerId}` document combines its funding vault and remaining primary shares. A unit therefore needs at most 29 position writes + 29 issuer writes + wallet + receipt + completed-unit record = **61 writes**, before any separately defined operation-progress bookkeeping. Read all required state before writing. Issuer updates may contend; process units sequentially initially.
3. Record each completed unit in the same transaction as its effects. If execution stops, resume missing units; do not restart balances from zero.
4. Reconcile manifest totals against receipts and all accounts. Partial authoritative transfers conserve credits, but are not presented as a complete event result.
5. Publish a complete projection/result version and advance the phase only when every unit and invariant passes.

Create pool system grants and fixed share inventory once before funding, with stable genesis IDs. Unsold primary allocation stays in the issuer's locked reserve. Seed settlement transfers shares from that reserve; it never mints extras. Final results are computed from frozen wallets and positions into versioned result records; they do not pay fictional winnings from or drain the exchange reserve.

The organizer invokes `continueOperation` until a job finishes. Each call has a bounded work/time budget and the UI exposes progress and resume. This removes a required background queue from v1 while remaining recoverable. If unattended processing becomes necessary, the same operation interface can run in a scheduled worker; the domain rules do not change.

## Reads, projections, and perceived speed

- Render cached static shell immediately; show connection/freshness state next to data.
- Publish one compact participant-safe catalog/market snapshot at most once per **two minutes** during trading, plus phase boundaries. List all 30 projects from that snapshot; search/filter locally. Direct Firestore reads check the caller's current approved membership; include these rule-dependent reads in the cost model.
- A quote opens a fresh single-pool read, so the two-minute Explore snapshot never establishes a trade price.
- Only active trading views subscribe to live private wallet/position data. Other members fetch a shared portfolio on entry and explicit refresh. Unsubscribe on hidden tabs/navigation.
- Publish funding standings after seed settlement and final investment standings after judging. There are no interim public investor rankings or live whole-event trade ticker. A private portfolio may show **Estimated liquidation value**: cash plus full-position sell proceeds calculated against the latest displayed pool reserves. Include those public reserve quantities and versions in the market snapshot so this calculation requires no extra pool fetches. Label the estimate with the snapshot's update time; it is neither guaranteed execution proceeds nor the final judge-based score.
- The organizer console requests a snapshot while visible. An expiring publication lease with a fencing version deduplicates attempts; a missing console produces an older snapshot, not broken trades. Manual retry honors the two-minute cadence; a phase transition uses a new phase version and can publish immediately.
- Keep the public-safe aggregate under a conservative 200 KiB design limit. Enforce profile text limits so it cannot grow unbounded. Separate detailed descriptions/updates/private data from the summary.

A projection is a convenience for reading, never input to execution or final scoring. Do not recompute every wallet on every trade. These limits are what make [the cost target](06-cost-and-platform.md) plausible.

The publisher claims a server-derived `(eventId, phaseVersion, twoMinuteSlot)` in a transaction. One event-level publication control document records the active owner, expiry, and a fence that increases across slots. Build the bounded snapshot outside that transaction. A final publication transaction verifies the current event phase version and active fence, rejects a superseded publication, and atomically writes the view and successful publication marker. An expired claim can be retried; claiming a slot alone never marks it published. A phase-transition refresh invalidates older work, so a slow worker cannot overwrite a closed-market snapshot. Repeated refresh calls in a published slot return the existing view without republishing. Account for lease reads and writes as well as the visible snapshot write.

## Security and deployment shape

Direct browser writes to authoritative records are denied, including profile and note writes in the first release; commands keep validation and permissions in one place. Read rules allow only participant-safe event data and private records belonging to the caller's approved team. Keep member emails, invite secrets, private notes, and unpublished scores out of market snapshots.

The Admin SDK bypasses Firestore Security Rules, so handler authorization and least-privilege service-account IAM are essential. App Check is an abuse signal, not a replacement for membership or trader-role checks. [Firestore server access and rules](https://firebase.google.com/docs/firestore/security/rules-conditions), [App Check enforcement](https://firebase.google.com/docs/app-check/cloud-functions).

Use separate local, staging, and production configurations. Never place service-account keys in the browser or repository. Use platform service identity for deployed functions and developer application-default credentials for approved operational scripts. Bootstrap the first organizer through a reviewed server-side administration script; a client cannot grant itself a role.

Choose a single region close to the venue and colocate functions with Firestore. Verify the region before provisioning because moving later is migration work. Use `minInstances: 0`, a small maximum instance count, request limits, short bounded jobs, and the other controls in the cost plan. Test a cold invocation before the event; warming by opening the organizer console shortly before a window is preferable to assuming low latency.

## Reliability and observability

Every accepted command gets an actor UID, event ID, team ID, command ID, rule version, server time, before/after versions, and balanced ledger entries. Log a correlation ID, outcome, latency, and safe reason code; do not log tokens, raw notes, or complete request bodies.

Expose to the organizer: current phase, latest snapshot age, pending operation progress, accepted/rejected trade counts from receipts, contention/error rate, and the last reconciliation result. Do not turn the admin page into an analytics dashboard.

Checkpoint exports at funding close, each trading close, and finalization contain sufficient authoritative data and manifests to explain/reconcile state. Store downloads securely with the organizer; an export is not an automatically tested restore system. A restore drill belongs in the release gate. Version schemas and retain ledger compatibility so the exported evidence remains readable.
