# Data and command contracts

Status: implementation specification for Firestore **Standard edition**, subject to emulator validation. Collection names below are proposed. Numeric economic rules are authoritative in [market rules](02-market-rules.md).

## Storage conventions

- Scope every game record to `events/{eventId}`. The first deployment operates one active event, but no code relies on a global current team or wallet.
- Store credits as integer hundredths (`creditsMinor`); use whole shares. Validate safe integer bounds on stored/transport values. Use `bigint` internally for reserve products and divisions, then validate before converting to JSON-safe integers.
- Give mutable authoritative documents an integer `version`. Every receipt records the versions it changed, `schemaVersion`, and `rulesVersion`.
- Use server-generated timestamps for acceptance and audit. Client timestamps are optional diagnostics only.
- Use independent authenticated UIDs, generated team IDs, and stable issuer IDs. Display names and tickers are labels, not database keys.
- Keep unbounded history in separate documents. Do not store an ever-growing trade array in a wallet or pool.
- Store document-sized, immutable input manifests only while under a checked 200 KiB design limit. Split larger manifests into keyed chunks before expanding the event-size limit.

## Authoritative records

Paths below are relative to `events/{eventId}` unless stated otherwise.

| Path | Main fields | Invariant / ownership |
|---|---|---|
| Event document | `phase`, `phaseVersion`, `windowId`, `opensAt`, `closesAt`, `paused`, `pauseReason`, `rulesVersion`, `rulesHash`, `rosterVersion`, `activeOperationId`, `publishedSnapshotId`, `publishedResultId` | Read by every economic command; only lifecycle service changes it |
| `rules/{version}` | Immutable economy parameters, score mapping, caps, tie policy, event limits | Frozen before seed opens; changing requires a new event after live play begins |
| `members/{uid}` | `teamId?`, `role`, `status`, `approvedAt`, `version` | One competing team per event; organizer cannot also compete |
| `teams/{teamId}` | Name, ticker, one-line pitch, problem, planned demo, links, `eligibility`, `captainUid`, `version` | Profile service; no emails, invite secrets, or unpublished judge data |
| `teams/{teamId}/updates/{updateId}` | Checkpoint ID, short text, demo link, author, publication time | Bounded update per checkpoint; editing history retained in audit |
| `wallets/{teamId}` | `cashMinor`, `reservedSeedMinor`, `version`, `lastTradeAt`, `tradeWindowId`, `successfulTradesInWindow` | One wallet per competing team; `0 ≤ reservedSeedMinor ≤ cashMinor` |
| `wallets/{teamId}/positions/{issuerId}` | Whole `shares`, `costBasisMinor`, `realizedPnlMinor`, `version` | No own-team position; bounds from rules; basis is private |
| `wallets/{teamId}/commitments/current` | Map `issuerId → shares`, `reservedMinor`, `version`, `updatedBy`, `updatedAt` | One editable sealed seed sheet per team; total reservation matches wallet |
| `wallets/{teamId}/notes/{issuerId}` | Thesis, change-of-mind condition, next check, author, `updatedAt`, `version` | Private team data; edits use expected version |
| `pools/{issuerId}` | `creditReserveMinor`, `shareReserve`, `version`, `halted`, `haltReason` | Exact current exchange reserves; no private trader data |
| `issuers/{issuerId}` | `issuedShares`, `primarySharesRemaining`, `fundingVaultMinor`, `version` | Fixed genesis supply; primary shares transfer to investors; vault is locked |
| `wallets/{teamId}/receipts/{commandId}` | Payload hash, command kind, actor, times, side, issuer, quantities, execution totals, journal entries, before/after versions | Immutable once accepted; financial evidence and idempotency result in one record |
| `operations/{operationId}` | Kind, input versions/hash, state, total/completed units, reconciliation status | Seed, genesis, or results operation; progress is resumable |
| `operations/{operationId}/units/{unitId}` | Stable unit key, status, receipt references, result hash | Unit completion is committed atomically with its effects |
| `manifests/{manifestId}` | Frozen roster/commitments or scores, canonical output plan, input/output hash | Immutable; readable by organizers, published safe parts separately |
| `adminAudit/{auditId}` | Actor, action, reason, target, previous/new values, command ID | Append-only application audit; no secrets in logged payload |
| `accessRequests/{requestId}` | Applicant UID, requested team, status, expiry | Approval is required; no money allocated on request |
| `invites/{inviteId}` | Hashed secret, approved scope, expiry, remaining uses | Server-only; plaintext invite secret shown once to authorized captain/organizer |
| `requestLimits/{uid}` | Small rolling/fixed-window counters and time | Server-only request throttle; separate from game trade limits |
| `projectionControl/market` | Event-level increasing fence, lease owner, expiry, slot, phase version, last publication version | Prevents slow/duplicate workers from overwriting a newer snapshot |

Profiles at the global `users/{uid}` path contain only that person's private account preferences and minimal display identity. Authentication owns credentials and email. Do not copy contact information into every team/event document.

Issuer reserve mutation adds writes during funding; the four-document transaction in the architecture applies to **secondary trades**, not every command. Genesis and seed settlement have their own bounded accounting units and must be included in the lifecycle cost allowance.

## Read projections

| Path | Contents | Update policy |
|---|---|---|
| `views/market` | Compact project summaries, displayed prices, pool reserve quantities/versions, eligible/paused status, published seed backing, timestamp | About once every two minutes during open trading and at phase boundaries |
| `views/standings` | Published seed ranking with `asOf`; final investment/judge standings only after results publication | Seed reveal and final publication; never per fill |
| `results/{resultVersion}/teams/{teamId}` | Frozen cash, final holdings/payouts, final score, tied rank | Built during finalization; publish only when complete |
| `results/{resultVersion}/issuers/{issuerId}` | Approved judge result, payout, eligibility outcome | Bound to immutable manifest and rule version |

The result publication pointer selects one complete version. A client never combines teams from different result versions. To correct an input error, publish a new audited version from the same frozen portfolio state; retain the superseded result and clearly label the correction.

Private estimated liquidation values use the reserves in the displayed market snapshot, with its timestamp. They do not require fetching every pool separately on each portfolio visit. A fresh execution preview still reads the selected pool. Show initial seed backers from the allocation manifest in v1; a continually updated current-holder count is deferred because it needs extra projection/accounting work.

No projection contains commitments or demand totals before the seed reveal. Organizers can technically access backend data but agree not to disclose live demand. UI privacy is not cryptographic sealing against database administrators.

## Visibility and permission matrix

| Data/action | Approved participant | Captain / trader | Organizer |
|---|---|---|---|
| Published event, market, pool summaries | Read | Read | Read |
| Own team's wallet, positions, commitments, receipts, notes | Read | Read | Incident review access, audited by command |
| Other teams' private data | No | No | Necessary operations/review only |
| Edit private investment note | Team member | Yes | Do not edit on team's behalf |
| Edit team profile/update | Team member | Yes | Moderate with reason |
| Change seed sheet / buy / sell | No | Yes | Cannot trade |
| Change trading delegation | No | Captain before seed; organizer after roster freeze | Yes, audited |
| Change phase / pause / finalize / exports | No | No | Yes |
| Raw score inputs and incomplete result versions | No | No | Yes |
| Edit balances, receipts, or raw reserves directly | No | No | No app workflow; controlled incident repair only |

All browser writes are denied in v1; these permissions describe callable application commands. Do not assume hiding a button enforces them.

**Read access design:** Firestore rules read the current event membership and require approved, nonsuspended status for market, pool, and private data. Private records also require matching team ID. Budget for these rule-dependent document reads. Publishing market summaries every two minutes leaves room for this simple access model while fresh trade-sheet reads preserve exact previews. Do not add role-bearing custom claims purely to save a small number of reads.

Removing a participant blocks subsequent authorized reads/commands under the current membership; it cannot erase data already downloaded to their device. A random event URL or team code is not sufficient authorization. Spectator access, if added, must have an explicit read role and a reviewed data/cost scope.

Private read rules must validate event scope, membership status, and matching team ID. Collection queries are not field filters: a private query must be scoped so every returned record is authorized. Server-side membership/role checks remain necessary because Admin SDK access bypasses rules. [Rules and access conditions](https://firebase.google.com/docs/firestore/security/rules-conditions).

## Commands

Every mutating request has `eventId` and an unpredictable client `commandId`; editable records also include the relevant expected version. Runtime schemas reject extra authoritative fields, unsafe numeric input, oversized strings, and unsupported URL protocols. The server derives actor UID from authentication.

| Command | Key inputs | Result / transaction boundary |
|---|---|---|
| `requestMembership` | Team invite or approved event entry code | Pending request; never creates a funded wallet automatically |
| `approveMembership` | Request ID, approved role, expected request version | Membership and audit; role constraints checked |
| `updateTeam` / `publishUpdate` | Bounded profile/update, expected version | Validated record + receipt/audit |
| `setTrader` | UID, expected membership/roster version | Enforces one captain plus at most one trader |
| `setSeedCommitments` | Complete target share map, expected wallet and commitment versions | Replace the whole sheet, update reservation, retain accepted-command evidence |
| `executeTrade` | Issuer, side, whole shares, expected pool/wallet/phase versions, approved price bound | Wallet + position + pool + immutable receipt, atomic |
| `saveInvestmentNote` | Issuer, bounded note, expected note version | Shared note, author/version, audit of edit |
| `transitionEvent` | Target phase, expected phase version, reason | Legal transition and audit; may create an operation |
| `setPause` | Paused flag, expected phase version, reason | Gate version + audit; never silently extends deadlines |
| `haltIssuer` | Issuer, expected issuer/pool version, reason | Disable execution; preserve historical records |
| `continueOperation` | Operation ID, expected kind/input hash | Process bounded missing units, return progress |
| `previewResults` | Frozen score input, declared score policy | Validated immutable draft manifest, payout table, reconciliation report |
| `publishResults` | Reviewed manifest ID/hash, expected phase version | Publishes only a complete reconciled result version |
| `refreshMarketView` | Event ID, expected two-minute slot/phase | Acquire expiring fenced lease, build bounded snapshot, discard if phase/fence changed; phase transitions bypass slot deduplication |
| `exportEvent` | Scope, result/manifest version, cursor | Authorized paginated JSON/CSV download with provenance |

Mutation receipts for notes/profile/admin actions need not have financial journal entries; economic receipts do. A no-op duplicate must never create another audit record or repeat a transfer.

### Trade transport example

```json
{
  "eventId": "event_2026_pilot",
  "commandId": "f14fe566-d8eb-4daf-a682-4d929963ced5",
  "teamId": "team_kestrel",
  "issuerId": "team_nimbus",
  "side": "BUY",
  "shares": 5,
  "expectedPhaseVersion": 12,
  "expectedPoolVersion": 0,
  "expectedWalletVersion": 4,
  "maxDebitMinor": 50633
}
```

The illustrative initial pool quote for five shares is 506.33 credits; this is a snapshot example, not a constant price. The server verifies that the authenticated caller may act for `team_kestrel`; it never trusts a supplied team ID by itself. Sell commands use `minCreditMinor` and must not carry an irrelevant buy bound.

Successful response contains `receiptId`, accepted command ID, exact shares and credit transfer, new wallet/position/pool versions, server acceptance time, and new wallet available balance. A subsequent receipt lookup returns those same values even if the pool or phase has since changed.

## Error vocabulary

| Code | Participant behavior |
|---|---|
| `SIGN_IN_REQUIRED` / `MEMBERSHIP_REQUIRED` | Sign in or request access; preserve a local draft |
| `TRADER_REQUIRED` | Explain who can act for this team |
| `MARKET_CLOSED` / `MARKET_PAUSED` / `ISSUER_HALTED` | Show the current state and reason; no automatic submission later |
| `STALE_QUOTE` | Fetch fresh pool state and require another review |
| `WALLET_CHANGED` | Refresh shared balance/holdings; another teammate may have acted |
| `INSUFFICIENT_CREDITS` / `INSUFFICIENT_SHARES` | Keep entered amount; show the available limit |
| `SELF_INVESTMENT` / `HOLDING_LIMIT` / `WINDOW_TRADE_LIMIT` | Explain the specific published rule |
| `COOLDOWN` / `RATE_LIMITED` | Show server `retryAfter`; do not generate a new command repeatedly |
| `COMMAND_CONFLICT` | Stop and report that the request identifier was already used |
| `RETRYABLE_CONTENTION` | Preserve command ID, use bounded retry/backoff; renewed economic review if versions changed |
| `RESULT_INPUT_INVALID` / `RECONCILIATION_FAILED` | Organizer-only repair flow; publication stays blocked |

Distinguish a known rejection from a lost response. “We’re checking whether this trade completed” is the correct uncertain state. Do not say “failed” and invite a second purchase when the first may have committed.

## Ledger and reconciliation

The journal records credit and share movements separately. Each economic receipt's credit entries sum to zero, and its share entries sum to zero **for each issuer**. Debit/credit direction is represented consistently as signed deltas. Pool and wallet values use the exact rounded amounts on the receipt.

Account types: team wallet, issuer funding vault, issuer exchange credit reserve, issuer primary share reserve, issuer exchange share reserve, investor share position, and system genesis source. System credits and original shares enter only through explicit genesis receipts. Keep the system source outside the circulating-credit total and record its issuance total separately.

For a secondary buy: wallet credits decrease, pool credits increase, pool shares decrease, investor shares increase. For seed: wallet credits decrease, issuer vault credits increase, primary reserve shares decrease, investor shares increase. Reservations change availability only; they do not transfer credits or create funding.

Reconcile:

1. Current total wallet cash + all exchange credit reserves + all funding vaults equals recorded genesis credits, absent an explicitly ledgered correction.
2. For every issuer, investor holdings + exchange inventory + remaining locked primary inventory equals fixed issued supply.
3. Wallet/position versions and balances agree with applying accepted receipts from a checkpoint.
4. Reserved seed credits exactly match the active commitment sheet; after completed seed settlement, all reservations are zero.
5. Every completed operation unit has its economic receipt and every published result uses the same manifest/rules/frozen state.
6. Final score is cash plus judge-based holding value. It is a result calculation, not an unrecorded increase to spendable cash or a payment from pool liquidity.

Append-only means the application never edits receipts. It does not make a project owner's privileged database access tamper-proof. Exported manifests/hashes and operator discipline provide independent evidence; do not advertise blockchain-style immutability.

## Query and index plan

Prefer direct document reads for current state and wallet-scoped queries for private history. Proposed composite indexes:

- Team receipts: `issuerId ASC, acceptedAt DESC` for a project's trade history within the wallet.
- Team receipts: `kind ASC, acceptedAt DESC` for filtered receipts.
- Members: `teamId ASC, status ASC` for approved roster.
- Access requests: `status ASC, createdAt ASC` for the organizer queue.
- Team updates: `checkpointId ASC, publishedAt DESC` only if the screen actually uses that combined query.

Single-field ordering by timestamp may need no composite index. Verify indexes against actual queries and commit only the required definitions. Exempt journal-entry maps, payload bodies, hashes, large projections, and note text from indexing when they are not queried. Do not invent a free-text search service for 30 teams.

Export with bounded cursor pagination, stable ordering, and a frozen/checkpoint version. Escape spreadsheet-formula prefixes in human-entered CSV fields. Prefer a streaming/local browser download for this small event rather than an uploaded export bucket or permanent public URL.
