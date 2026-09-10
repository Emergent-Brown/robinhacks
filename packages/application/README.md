# Application boundary

`GameService` is the browser-safe entry point shared by the demo and Firebase. It accepts a `Repository`, an event ID and a `Clock`; it never reads authentication tokens or constructs Firebase clients. The Functions transport supplies the authenticated UID. The demo transport supplies its explicitly labeled local identity.

| Module                           | Responsibility                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------- |
| `command-schema.ts`              | Strict request parsing, bounded text/maps, safe IDs and canonical replay payloads |
| `game-service.ts`                | Authorization, transaction boundaries, snapshots and organizer commands           |
| `services/permissions.ts`        | Membership, team, trader and organizer policies                                   |
| `services/market-service.ts`     | Secondary fills, sealed commitments, notes and public projection                  |
| `services/membership-service.ts` | Verified access requests, team genesis, roster and profiles                       |
| `services/operation-service.ts`  | Immutable funding/result manifests, resumable team units and reconciliation       |
| `paths.ts`                       | Event-scoped storage path construction                                            |
| `repository.ts`                  | Minimal persistence and clock interfaces                                          |

Economic arithmetic belongs in `@robinhacks/core`. Firebase SDK details belong in `apps/functions/src/firestore-repository.ts`. UI components call a gateway; they do not import these persistence details.

## Persistence guarantees

Repository transactions provide atomic commits, rollback on an exception and read-your-writes semantics. Firestore buffers all writes until application reads finish, then flushes the final document values into the native transaction. Its retry callback reacquires the clock. Financial commands sample the clock again after their authoritative reads, before checking the exclusive deadline.

A secondary fill writes exactly its wallet, position, pool and immutable receipt. Its receipt doubles as the replay record. Generic commands have separate accepted-command records. A repeated identifier with changed content is rejected. Role and phase checks use current event records, never client claims.

A funding operation freezes requests once and applies one entire investor team per transaction. Completed-unit markers and financial effects commit together. A final continuation reconciles credit issuance and every issuer’s share supply before publishing funding. Final results use frozen wallets and holdings, produce separate report documents and leave the financial ledger unchanged. A final reconciliation compares those reports and the current financial state with the immutable manifest before making the report ready. Publication is explicit.

## Read model

The browser can listen only to its own membership, approved event metadata and the approved public market projection. Private portfolio data and organizer exports use authenticated callables. Team-member mirrors keep ordinary snapshots from loading the entire event roster. Sealed funding totals remain absent from the market projection until all settlement units reconcile.

`exportEvent()` requires an organizer and a paused or closed event. It exports an event-scoped JSON ledger, manifests and per-team private records and records the access in the audit log. Financial accounts are fictional credits; a report value never becomes spendable wallet cash.

## Operational bounds

The first version supports 30 teams and 150 approved participants. Funding uses at most 29 outside issuers per team unit. Immutable manifests are checked against a 200 KiB application limit. Functions reject command bodies above 16 KiB and apply per-instance request burst limits in addition to the game’s accepted-trade limits. Per-instance limits reset on cold starts; Auth quotas, App Check and bounded instances complement them. They do not constitute a hard billing cap.

App Check enforcement is selected using `ENFORCE_APP_CHECK=true` after registering the web app and configuring its provider. This staging switch does not disable Firebase Authentication, application role checks or Firestore rules.
