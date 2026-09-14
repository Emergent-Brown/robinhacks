# Implementation and maintenance

> **Historical version-one document (September 8–10, 2026).** This trading proposal/implementation record is preserved for context. [11 · Sealed funding rounds](11-sealed-rounds.md) supersedes its current product rules, lifecycle and architecture. Do not use the old buy/sell instructions for a version-two event.

Status: implemented application, updated September 10, 2026. This document describes the repository’s current behavior. Documents 01–08 remain the original design blueprint; use this document and the code where their proposed API names, read permissions, jobs or operational details differ. Cloud setup and deployment state are documented separately in [Firebase setup](FIREBASE-SETUP.md).

## 1. Supported application

RobinHacks supports one configured event with up to **30 teams and 150 approved participants**. Storage and commands are event-scoped, so the domain does not depend on a global current team. The web app selects its event using `VITE_EVENT_ID`; it does not provide a multi-event administration interface.

The participant UI has Projects, Portfolio, Standings and My team destinations, responsive desktop navigation, mobile bottom navigation, project detail views, funding/trade sheets, review steps, private notes and receipts. The organizer console controls registration approvals, roles, phases, announcements, eligibility, exports and results publication.

There are three runtime modes:

| Mode | Persistence and identity | Purpose |
| --- | --- | --- |
| `demo` | Local storage and explicit demo identities | Immediate product exploration, including organizer role switching |
| `emulator` | Local Firebase Auth, Firestore and Functions | Exercise actual SDK calls, rules and transactions without cloud writes |
| `firebase` | Configured Firebase project | Approved participants and the event organizer |

The browser demo is intentionally editable local data. It provides no security boundary or multi-user server. Production uses authenticated callables and denies direct financial writes, even to organizers.

## 2. Module ownership

| Location | Responsibility |
| --- | --- |
| `packages/core/src/rules.ts` | The frozen numerical economy constants |
| `ConstantProductPool` | Exact buy/sell quotes and reserve changes using integer arithmetic |
| `FundingAllocator` | Pro-rata primary allocation and deterministic SHA-256 tie ordering |
| `PortfolioAccounting` | Acquisition basis and realized P/L after buys and sells |
| `ResultScorer` | Tied judge ranks, final share values and frozen portfolio reports |
| `EventPolicy` | Legal transitions, financial phase/deadline gates and trade limits |
| `packages/application/src/game-service.ts` | Public application facade, command dispatch, read authorization and transactions |
| `services/market-service.ts` | Trades, commitments, notes and public market projection |
| `services/membership-service.ts` | Requests, approval, team genesis, role correction and profiles |
| `services/operation-service.ts` | Immutable manifests, resumable team units and reconciliation |
| `services/permissions.ts` | Team, trader, organizer and editable-phase policies |
| `repository.ts`, `paths.ts` | Persistence contract, clock contract and event-scoped paths |
| `apps/functions/src/` | Callable transport, runtime limits and the buffered Firestore repository |
| `apps/web/src/adapters/` | Firebase and demo implementations of `AppGateway` |
| `apps/web/src/features/` | Product views and their forms |

Classes encapsulate the parts with business rules or replaceable infrastructure. Persisted records are typed data, and React components are functions. There is no inheritance hierarchy or service framework to maintain. The application package can run in a browser because it imports no Node or Firebase SDK code.

A typical change follows one direction: core rule → application authorization/transaction → transport contract → UI. New features should use those existing boundaries instead of calling Firestore from a component or copying trade arithmetic into a form.

## 3. Commands and transaction semantics

The public service API is:

```ts
new GameService(repository, eventId, clock)
  .execute({ uid, displayName }, command)

service.snapshot(uid)
service.pool(uid, issuerId)
service.exportEvent(uid)
```

Production callables are `gameCommand`, `gameSnapshot`, `gamePool` and `gameExport`. Every request supplies `eventId`; the callable supplies the actor from Firebase Authentication. The command envelope contains `{ eventId, command }`. Pool reads contain `{ eventId, issuerId }`. Snapshot/export reads contain `{ eventId }`.

Strict Zod schemas reject unsupported fields, invalid identifiers, unsafe numeric values, oversized text/maps, and unsupported URL schemes. Command bodies are limited to 16 KiB at the Functions boundary. Team authority comes from current event membership, never a client-provided team ID.

`Repository.transaction()` provides atomic commits, rollback on rejection and read-your-writes behavior. The memory adapter serializes transactions against a working copy. The Firestore adapter buffers writes, merges staged values into subsequent `get/list` calls, and flushes only after every application read has completed. This satisfies Firestore’s requirement that native transaction reads precede writes.

A secondary fill changes exactly **four documents**: wallet, position, pool and immutable receipt. That receipt is also its replay record. Generic commands use separate accepted-command records. Reusing an accepted ID with altered content is a conflict. Retries preserve the ID; rejected stale quotes need another explicit review before a fresh command.

Financial services sample server time after their authoritative reads, including after a Firestore transaction retry. A deadline is exclusive: acceptance requires `now < closesAt`. Phase/pool/wallet versions, membership, holdings, cash, eligibility, cooldown and allowance are checked inside the same transaction. A successful client preview alone gives no execution authority.

## 4. Registration and roles

Signing up creates an authenticated person. Requesting access creates a pending event request; it does not issue credits. An organizer verifies requests and chooses either a new team with a captain or an existing team. New-team approval atomically creates the profile, wallet, pool, primary issuer and genesis accounting receipt.

Organizers have no competing team. A team has one captain and at most one additional trader. Approved members can read the shared portfolio, edit project information and keep investment notes. Before funding, the captain can designate an approved teammate as trader. Later roster corrections require an organizer and a paused event. New teams cannot be created after funding opens.

Each approved team membership is mirrored under `teams/{teamId}/members/{uid}` for a bounded team roster read. The authoritative role remains `members/{uid}`. Both are updated by the membership service in the same transaction.

New and pending participants receive `joinableTeams`, a bounded list of active team IDs and names. They do not receive market or private team data. Requests to existing teams can queue during funding, build time, trading and frozen judging; approvals after Registration still require an organizer and a paused event. Settlement and terminal phases reject new requests. Password reset is available for email accounts. Email verification and backup-organizer controls remain listed in the [event audit](10-product-audit.md).

## 5. Funding and finalization

Seed commitments reserve cash within the existing wallet: `cashMinor` includes the reservation, while available cash is `cashMinor - reservedSeedMinor`. Editing commitments changes the reservation and sheet version. Withdrawing/disqualifying a project before settlement immediately releases affected reservations; withdrawing a team also releases its own outstanding sheet.

Closing seed creates an immutable manifest of requests, reservations and allocations. Continuation applies one investor team’s full allocation per transaction. Its wallet, positions, issuer vaults/inventories, receipt and completed-unit marker commit together. A retry checks progress instead of charging again. The final continuation reconciles all credits and share inventories, then publishes funding and enters intermission.

An organizer’s Continue settlement action advances these bounded units. Closing the tab can interrupt the sequence; the next continuation resumes from stored progress. There is no background task queue or Cloud Scheduler dependency.

Final trading closes into intermission and then freezes permanently. The organizer enters externally collected aggregate judge scores from **0 to 100**, with at most two decimal places. The UI previews tied ranks and final share values before scores are locked. Each result unit reads a frozen manifest and writes a report. Completion verifies the reports and that financial state still matches the frozen inputs. Publication then exposes one complete result version.

Results never add spendable cash, retire shares, sell into pools or alter cost basis. The implementation has no post-publication correction workflow; final publication and cancellation are terminal competition decisions. Keep the independent judging award separate from the market side game.

## 6. Actual read and privacy model

Firestore client rules permit only:

- An authenticated person’s own membership document, including pending/suspended status.
- The exact event document for an approved member of that event.
- The exact public `views/market` document for an approved member of that event.

Collection listing and all client writes are denied. Direct wallet, position, commitment, note, receipt, raw team, other-member, manifest and result reads are denied, including organizer reads. Authenticated server callables enforce the required private access instead.

`gameSnapshot` returns an approved participant’s own wallet, holdings, notes, commitments, receipt history and team roster alongside the public market. Pending people receive event metadata and their own request status. Organizers receive the access queue, event roster, audit log and current operation/result preview. Unpublished results are excluded from participant snapshots. Necessary organizer access to complete private event data goes through an audited export.

The gateway caches private snapshots and coalesces simultaneous requests. Local commands, explicit refresh, membership changes and event phase changes invalidate that cache. Public market updates replace the cached projection without refetching every private record. Hidden tabs detach market/event listeners and refresh when visible again. A teammate’s private wallet changes do not create a continuous private listener; a refresh or rejected stale wallet version retrieves the new state.

The visible organizer session requests a public market refresh about every two minutes. A refresh reads at most 30 teams, pools and issuers and publishes one document in a single Firestore transaction. Phase/profile/eligibility changes can also refresh it immediately. Concurrent refreshes are serialized through the projection document. There is no separate lease/fence worker: the bounded snapshot is small enough to publish atomically.

If no organizer session is visible, public prices can age. The app displays the snapshot’s time, while a selected project’s trade review fetches its fresh pool. Financial authorization never depends on the projection’s freshness.

## 7. Differences from the original blueprint

| Original proposal | Implemented first release |
| --- | --- |
| Broad approved direct reads of private Firestore paths | Three narrow listener paths; private reads use authenticated callables |
| Projection lease/fence worker | One bounded transaction for the entire 30-team projection |
| Background or scheduled operation processing | Organizer-driven resumable units with persistent progress |
| Native judging/conflict-management workflow | Externally collected aggregate scores, organizer review and immutable publication |
| Invite secrets or verified event-entry codes | Authenticated requests with explicit organizer approval |
| Versioned rules documents and hashes for many configurations | Rules version 1 in the core package; an event must match the supported version |
| Project update history by checkpoint | One editable current update on the team profile, with audited edits |
| Separately published standings projections | Funding in the complete market projection and one published result document |
| Database-backed request throttles | Best-effort per-instance burst limits, alongside Auth, optional App Check and instance bounds |
| Post-publication report corrections | No correction UI; published results remain immutable |

The numerical market rules remain in `RULES`. Do not change active-event economics by editing constants and deploying under the same rules version. A rules change needs a new reviewed version, corresponding tests and a new event or explicit migration plan.

## 8. Running and verification

```sh
npm install
npm run dev
npm run check
npm run test:emulator
```

`npm run dev` defaults to local demo mode. `npm run dev:firebase` additionally requires Java 21+ and starts local Auth/Firestore/Functions before seeding accounts. `npm run seed -- --seed` resets a running emulator into the funding phase; without `--seed`, the fixture starts during trading. Seeding replaces the local fixture event, so preserve any local rehearsal export before resetting it. Use `WEB_PORT=5174 npm run dev:firebase` if the default Vite port is busy. Run `npm run test:smoke` in a second terminal after the emulator app is ready; it targets only `demo-robinhacks` on localhost and leaves one accepted test purchase in the fixture.

| Command | Coverage |
| --- | --- |
| `npm test` | Domain arithmetic, market simulations and shared service integration |
| `npm run typecheck` | Cross-package TypeScript contracts |
| `npm run format:check` | Repository formatting consistency; `npm run format` applies it |
| `npm run build` | Production web and bundled Functions output |
| `npm run check` | Typecheck, ordinary tests and both production builds |
| `npm run test:emulator` | Firestore rules plus the actual Firestore repository’s staged writes and funding operation |
| `npm run test:smoke` | Local Auth + callable Functions, a real trade, replay protection, role denials and export reconciliation |
| `npm run reconcile -- /path/to/export.json` | Exported cash totals, issuer share supply and balanced receipt entries |

Tests cover accepted-command replay, changed payload conflicts, concurrent shared-wallet spending, financial deadlines crossing during reads, role/holding/phase limits, private snapshots, teammate mirrors, immediate reservation release, interrupted funding, frozen results, tied scores and market simulations for 10, 20 and 30 teams. Emulator tests exercise unauthenticated, pending, suspended, cross-event and competing-team access; financial writes remain denied for every client role.

A production rehearsal should also cover mobile navigation, authentication, the registration queue, a full seed/trading/judging cycle, exports and recovery after closing the organizer browser. Test coverage is evidence for the implemented invariants, not a guarantee about strategic fairness, real attendance or billing.

## 9. Deployment, costs and remaining operational choices

The configured production project is `robinhacks-2026-ajs`, with Firestore Standard and Functions in `us-west1`. See [Firebase setup](FIREBASE-SETUP.md) for the current cloud status, web environment variables, verified-CLI bootstrap and deployment steps. Keeping this README’s configured target is not a claim that every remote resource has finished deploying.

Functions have zero minimum instances and at most two instances **per callable**. Limits are 90 commands, 60 snapshots, 90 pool requests and two exports per authenticated UID per minute per instance. These protect against ordinary bursts, reset on cold starts, and can be spread across instances. They are not account-wide quotas or a spending ceiling.

App Check is staged: configure the web reCAPTCHA Enterprise site key and then enable `ENFORCE_APP_CHECK=true` for Functions. Authentication, membership enforcement, strict input validation and Firestore rules apply regardless of that switch. Production Google/email sign-in settings and billing setup belong to the Firebase project, not demo fixtures.

The target is normal pilot usage within Firebase’s no-cost allowances on a billing-enabled plan. The original cost estimate assumes its proposed read model; this build’s cached callables and narrow listeners change the actual request mix. Measure usage during rehearsal, keep idle/hidden listeners limited, and set budget alerts. Alerts and configured instance limits do not guarantee a $0 bill.

The first release intentionally omits spectator access, live individual judge ballots, trading history charts, transfers, multiple funding rounds, secondary fundraises, payouts and native mobile apps. Team profiles contain text and links rather than uploaded media. These choices keep the pilot focused and reduce operational dependencies.
