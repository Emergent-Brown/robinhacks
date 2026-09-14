# Event operations

> **Historical version-one document (September 8–10, 2026).** This trading proposal/implementation record is preserved for context. [11 · Sealed funding rounds](11-sealed-rounds.md) supersedes its current product rules, lifecycle and architecture. Do not use the old buy/sell instructions for a version-two event.

Status: proposed runbook. Screens and commands described here must be implemented and rehearsed before an event.

## Organizer responsibilities

Assign one primary operator and one backup. Both have individual organizer accounts; neither manages a competing wallet. The operator controls the event and records decisions. Judges independently evaluate projects without seeing private portfolios or using market prices as their rubric.

Use one clear control page: current phase, next action, prerequisites, pause, last snapshot age, operation progress, and incident/export links. Put unusual or destructive operations elsewhere. Participant screens and admin screens consume the same authoritative phase state.

## Configuration before opening

Verify the roster, team pages, roles, and duplicate memberships. A team that joins after seed opens is not retroactively added to the current competition. It can exhibit as a noncompeting project outside the trading roster; admitting a funded competitor late would require a different fairness policy.

Freeze the economic rules, participating issuers, tie seed, judge assignment/conflict policy, and number of trading windows. Announce each window's opening and latest closing time. The 20-minute seed round and three 30-minute trading windows are the proposed default; the [product schedule](01-product-brief.md) is illustrative.

Publish this participant explanation:

> Your team has 10,000 credits. Back other teams during seed funding, then buy or sell during the trading windows. You can hold up to 25 shares in each other team. Credits are fictional. Judges' final rankings determine share values and the investment results.

The full rules must also explain primary allocation, fixed inventory, pool liquidity, failed/withdrawn projects, trade caps, independent final values, and the absence of guaranteed proceeds. Avoid forcing a rules modal before every investment.

## Exact lifecycle

`paused` is a separate gate overlay. Every transition increments `phaseVersion`, records actor/reason/time, and compares the expected previous version.

| From | To | Required condition |
|---|---|---|
| `DRAFT` | `REGISTRATION` | Event settings are complete enough to invite teams |
| `REGISTRATION` | `SEED_OPEN` | Approved/frozen roster and rules; genesis wallets/pools/inventory reconciled |
| `SEED_OPEN` | `SEED_SETTLING` | Deadline reached or deliberate early close; immutable commitment manifest ready |
| `SEED_SETTLING` | `INTERMISSION` | All team units settled; reservations zero; supply/credits reconciled; reveal prepared |
| `INTERMISSION` | `TRADING_OPEN` | Next configured unused window; seed completed; issuers eligible; scheduled time reached |
| `TRADING_OPEN` | `INTERMISSION` | Window closed and another configured window remains |
| `TRADING_OPEN` | `FROZEN` | Final window closed, or organizer permanently ends trading early |
| `INTERMISSION` | `FROZEN` | Remaining windows deliberately canceled before judging |
| `FROZEN` | `FINALIZING` | Trading permanently closed; complete validated independent judging inputs |
| `FINALIZING` | `FINALIZED` | Complete result version; reconciliation passed; organizer reviewed manifest and publication |
| `FINALIZED` | `ARCHIVED` | Results/export saved; retention mode enabled |
| Any nonfinal competition phase | `CANCELLED` | Organizer confirms cancellation with reason; all economic commands disabled |
| `CANCELLED` | `ARCHIVED` | Incident/history exported; no competition winners published |

No backward transition reopens a funded or judged phase. Window IDs are configured in advance and consumed once. Pause/resume neither adds a window nor resets the 15-trade allowance. When the server deadline expires, trades are closed even if the stored phase has not yet been advanced by the organizer.

An early close is allowed and audited. An extension is not silently inferred from a pause. For the pilot, a missed or prematurely closed window remains closed; use the next previously announced window or cancel the remaining market portion. Repeated failures warrant stopping the side game while continuing the hackathon.

## Seed close and reveal

1. Close funding. New commitment edits are rejected by the server.
2. Create the immutable allocation manifest from the frozen roster and commitment versions.
3. Process team settlement units. Each unit debits only allocated seed credits, releases the rest, transfers primary shares, updates the relevant locked vaults, and writes its receipt/checkpoint atomically.
4. Resume any unfinished units; never start a second operation or edit balances to speed things up.
5. Reconcile all wallets, issuer inventory, vault totals, and zero reservations.
6. Publish one complete reveal and move to intermission. Show actual funded credits and allocated shares, not requested amounts as money raised.

An oversubscribed team receives fewer shares and keeps the unused reserved credits. An unsubscribed issuer still has its original exchange pool and may attract interest later. No price/stage reset or additional wallet grant happens at the next trading window.

## During a trading window

Open the configured window only after the progress-update checkpoint. Keep the organizer console visible so it can request bounded market projections, but recognize that closing the console affects display freshness, not trade authorization.

Watch errors and outstanding operations. A brief spike in stale quotes around a popular project can be normal. Repeated transaction failures, inconsistent receipts, or unauthorized behavior are reasons to pause. Check a receipt before retrying an action described as “stuck.”

At close, the server deadline blocks new admissions and the event gate gives manual close a consistent order against in-flight trades. A trade accepted immediately before close may appear immediately after; its receipt remains valid. Refresh the closing market view and reconcile before the next window.

## Incident response

| Incident | Response | Resume condition |
|---|---|---|
| Venue Wi-Fi outage | Pause new activity if needed; tell teams results are not confirmed until a receipt exists | Network recovered; old pending commands resolved; original deadline still valid |
| One trade timed out | Query/retry the same command ID; inspect receipt | Known accepted result or known rejection; never a guessed second trade |
| Many stale quotes | Keep honest re-review behavior; inspect pool contention and client freshness | Normal execution resumes; no automatic wider price bounds |
| Suspected compromised account | Suspend its current membership and pause if necessary; audit actions | Organizer restores access through a recorded role change |
| Suspected collusion | Preserve evidence; review receipts and apply the announced event policy | Documented decision; no automatic guilt from a pattern flag |
| Issuer withdraws after the seed allocation manifest locks | Complete that immutable manifest if settlement is unfinished, halt its stock, preserve history; final share value is zero | Other issuers may continue; do not invent a retroactive fixed-price refund |
| Settlement process stops | Keep participants in settling state; resume missing stable units | All units and invariants pass |
| Reconciliation fails | Pause/retain finalization lock; export evidence and diagnose | Explained, tested repair or cancellation; never an arbitrary balance edit |
| Cost/use exceeds rehearsal envelope | Stop unnecessary projections/listeners, inspect usage, pause if operationally needed | Organizer accepts the measured budget or ends the side game fairly |
| Admin accidentally closes early | Keep the close and explain it; next configured window remains available | No reopening of the same consumed window |

The app's pause is not a billing kill switch and does not erase already downloaded data. The runtime must still authenticate and reject requests; those requests may consume resources. Billing alerts and service-specific controls are described in [the platform plan](06-cost-and-platform.md).

If cancellation occurs during a seed or result job, stop new units. A unit already serialized before cancellation may finish and remains in the ledger. Preserve the partial operation, mark it canceled, and publish no competition results. Credits have no value, so inventing financial refunds is unnecessary; retain an explanation of the stopped event. A new game uses a new event ID rather than resetting this history.

## Judging and publishing results

Freeze trading **before final presentations and any judge-result disclosure**. Use a small published rubric, such as usefulness, execution, technical quality, and clarity. The organizer must settle the exact weights and scoring precision before the event; market behavior is never a rubric dimension.

Recommended judging input contract: equal criterion weights for the pilot; each criterion an integer 0–5; sum each judge's four criteria to a 0–20 result; require at least two nonconflicted judges per project and use the exact rational mean of their totals. Rank by that unrounded mean, with exact equal means tied. Validate coverage and conflicts before freezing the manifest. If another rubric is chosen, freeze its deterministic aggregation and tie rule instead.

Organizers can enter results or import a strictly validated CSV exported from the judges' agreed worksheet. A separate judge portal is unnecessary in v1. Missing results block publication. A withdrawal/disqualification is an explicit event decision, not a convenient way to fill a missing cell.

1. Validate issuer IDs, judge identities, conflicts, score bounds, duplicate rows, and required coverage.
2. Lock a score manifest and compute the rank-to-share-value table.
3. Compute versioned final team results from frozen cash and positions. Do not mutate the historical trading wallet or mint spendable payout credits.
4. Reconcile the frozen ledger and recompute each result independently from the manifest.
5. Review the concrete payout table, ties, exclusions, and team totals. `Publish results` is the organizer's explicit final action.
6. Publish one complete result version. Exact tied investor totals share rank; do not invent a tiebreaker after seeing them.

A score transcription error after publication creates a corrected result version with a reason and visible change notice. Keep the original version and its inputs for audit. Do not reopen trading or overwrite historical receipts.

## After the event

Export the frozen rules, roster IDs/roles, input manifests, accepted economic receipts, checkpoints, reconciliation report, public backing summary, and final result version. Keep private notes/emails out of public results and separate them in authorized exports. Use JSON for complete machine-readable evidence and CSV for human review.

Archive the game, stop refresh workers, and disable new registration/trading. Proposed retention: keep private event data for 30 days to resolve issues, then deliberately remove it or keep only the consented minimal public results. The organizer must choose and publish the actual retention period before collecting participants' data. Apply the same policy to downloaded exports and backups; database deletion cannot remove an operator's local copy.

Collect a short participant debrief: did it cause useful project conversations, was the share pricing understandable, did anyone feel obliged to spend time trading, and which screen was confusing? Use that evidence to decide whether the next event needs multiple funding rounds, individual portfolios, faster market updates, or none of them.
