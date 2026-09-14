# Market rules

> **Historical version-one document (September 8–10, 2026).** This trading proposal/implementation record is preserved for context. [11 · Sealed funding rounds](11-sealed-rounds.md) supersedes its current product rules, lifecycle and architecture. Do not use the old buy/sell instructions for a version-two event.

Status: selected recommendation for the first implementation. Numerical defaults below are a coherent starting configuration for an event with 10–30 teams and approximately 150 people; they are not claims about a tested live economy.

This is a play-money game about discovering good projects. Credits have no cash value. Shares are game units, not legal ownership, revenue rights, or money contributed to a real business. The core hackathon result comes from independent judging. Funding and portfolio results provide additional recognition.

## 1. The selected mechanism

Run one sealed, fixed-price funding round, followed by three short trading windows. Each project has a pool of shares and system-issued credits that gives participants immediate buy and sell quotes. At the end, a frozen portfolio report values shares according to the project's independent judging rank. Finalization calculates a score; it does not transfer credits, retire shares, or change the frozen portfolio.

Three different quantities must remain distinct:

| Quantity | Meaning | Source of truth |
| --- | --- | --- |
| Funding raised | Credits actually allocated in the primary funding round | Completed primary allocations and the project's locked funding vault |
| Market price | The current marginal ratio of a project's secondary pool | Pool credit reserve divided by share reserve |
| Final redemption price | The per-share value used to calculate the final portfolio score | Locked judge results and the published scoring formula |

Secondary buying never increases the funding-raised figure. A secondary purchase pays the pool; a sale receives credits from the pool. The funding vault cannot be spent by a team or withdrawn. Its purpose is to record support without allowing a well-funded team to buy more influence in other teams.

Why fund early: the primary round offers the same fixed price to everyone, avoids pool price impact, allocates scarce inventory simultaneously, and reveals which teams earned initial support. Later windows let teams change their views after progress checkpoints. Funding buys the same share unit traded later; there is no special liquidation preference or funding bonus.

## 2. Defaults frozen before the event

| Setting | Default |
| --- | --- |
| Initial team wallet | 10,000.00 credits |
| Credit precision | 0.01 credit; stored as integer minor units |
| Share precision | Whole shares only |
| Fixed primary price | 100.00 credits/share |
| Fixed share supply per project | 500 shares |
| Primary sale inventory | 100 shares |
| Opening secondary inventory | 400 shares |
| Opening secondary cash reserve | 40,000.00 system-issued credits |
| Maximum primary commitments per team | 5,000.00 credits across all projects |
| Maximum primary request per outside project | 25 shares |
| Maximum participant holding per outside project | 25 shares, including primary and secondary acquisitions |
| Suggested funding window | 20 minutes after project pitches |
| Suggested trading windows | Three windows of 30 minutes each, after progress checkpoints |
| Maximum accepted secondary trades | 15 per team per trading window |
| Minimum gap between accepted secondary trades | 10 seconds per team wallet |
| Trading fee | Zero; integer rounding can retain a fraction of a credit in the pool |
| Quote preview refresh prompt | 10 seconds; this is a UI convention, not server authorization |
| First-place final redemption | 175.00 credits/share |
| Last-place final redemption | 25.00 credits/share |

The 25-share cap is a share-count cap. It is approximately 25% of the initial wallet at the opening price; it does **not** cap current portfolio exposure at 25%. Avoid a moving cost-basis or percentage-of-equity constraint in the MVP.

The opening pool depth makes a first 25-share buy cost 2,666.67 credits, approximately 6.67% above the opening price on average. This is a useful, understandable amount of price impact for a small event. Stress-test it with simulated 10-, 20-, and 30-team behavior before using it for a real event.

These parameters are frozen before registration closes. An admin cannot change a price, reserve, holding cap, per-window trade allowance, or payout formula during the competition. Changing an event's cost-bearing limits before the freeze also requires recalculating its operating budget.

## 3. Teams and authority

- Each registered team owns one wallet and issues one project stock. Member count does not change its allocation.
- Teams may hold and trade only other teams' stocks. Team members cannot obtain an additional wallet by signing in separately.
- One captain can trade by default. Before funding opens, the captain may designate at most one additional trader; all other members can view their team's portfolio. After funding opens, role changes require an organizer correction while paused. Wallet version checks prevent the two authorized members from spending the same balance.
- Event staff must be separate from competing trader identities. Judge assignments and event configuration are frozen before trading. A judge cannot rate their own team or a declared conflict; the judging workflow must resolve missing or insufficient coverage before finalization.
- Only registered, active issuers can receive funding or trades. Teams cannot change membership or create additional issuers during the competition without a recorded organizer correction while the event is paused.
- No gifts, wallet-to-wallet transfers, private negotiated trades, short selling, borrowing, leverage, or negative participant balances.

Authentication identifies a person. Server-side event membership, team membership, and role determine their authority. A client-supplied team ID is never sufficient authorization.

## 4. Funding: sealed commitments and simultaneous allocation

### Commitments

While funding is open, an authorized trader can request 0–25 whole shares in each outside project at 100.00 credits each. Zero withdraws that request. A team can have no more than 5,000.00 credits committed in total.

Committing reserves credits within the team's cash balance atomically. The canonical wallet fields are `cashMinor`, which **includes** reserved credits, and `reservedSeedMinor`. Available cash is `cashMinor − reservedSeedMinor`. Editing a request changes only its reservation difference; it does not change `cashMinor`. The UI shows available cash and reserved funding cash separately. Both belong to the team until allocation; neither is investment profit. Never sum `cashMinor + reservedSeedMinor` as wallet wealth or event cash.

Only the requesting team and authorized event staff can read its commitments. Other teams cannot read its available cash or other derived fields that would reveal commitments. Hide issuer demand, backer lists, and public funding totals until **all** allocations have completed. Admin access is a trust boundary, not cryptographic secrecy.

The server rejects edits at or after the funding deadline, even if a browser still displays an open form. The organizer may close earlier. Once closed, commitments become an immutable allocation input; do not reopen the same round or accept late requests.

### Allocation

Process each issuer independently from the frozen input. Let `S = 100` available shares and `d_i` be team `i`'s requested shares.

1. If `sum(d_i) <= S`, allocate every request in full.
2. Otherwise, calculate `base_i = floor(S × d_i / sum(d_i))`.
3. Calculate `remainder_i = (S × d_i) mod sum(d_i)`.
4. Assign the remaining shares one at a time in descending remainder order.
5. Resolve equal remainders by ascending SHA-256 hex digest of `eventAllocationSeed + ":" + issuerId + ":" + teamId`, then immutable team ID in the unlikely event of a digest collision. Publish and freeze the event allocation seed before commitments. This order does not depend on submission speed or the organizer's choice at allocation time.

All calculations use integers. Each allocation is at most its request. Total allocation equals `min(S, sum(d_i))`. Each allocated share costs exactly 10,000 minor units.

Debit allocated purchases from `cashMinor`, transfer that exact amount into issuers' locked funding vaults, and clear the team's `reservedSeedMinor`. Unallocated commitments become available again because the reservation clears; they are not an additional cash credit. Transfer allocated shares from each issuer's primary inventory to the team's positions. Unsold primary shares remain in locked primary reserve permanently; they are not added to the pool or offered in a surprise second sale.

For example, five teams requesting 25 shares each produce demand for 125 shares. Each receives 20 shares, pays 2,000.00 credits, and gets 500.00 credits of its reservation released. The project raises 10,000.00 credits.

### Completion and recovery

Allocation runs while the event is locked. First compute all issuer allocations from the frozen commitments and persist an immutable allocation manifest. The manifest contains each team's exact allocations, purchase debit, and released reservation. Calculating an allocation is per issuer; applying it is per investing team.

Apply one team's **complete** allocation in one transaction: debit its wallet cash, clear all its seed reservations, update all affected positions and their acquisition cost, transfer credits and shares through affected issuer documents, and write the team's immutable settlement receipt and completed-unit marker. Each issuer document combines its funding vault and remaining primary inventory. With 30 teams, one investing team can affect at most 29 outside issuers, so the upper bound is 1 wallet + 29 positions + 29 issuer documents + 1 receipt + 1 unit marker = 61 writes. Only include affected entries. Process team units sequentially initially because they can touch the same issuer documents.

The unit marker is committed atomically with its effects. An interrupted job resumes missing team units from the immutable manifest and does not recalculate allocations, charge a wallet again, or issue shares twice. All investors in the same issuer use the same manifest; processing order cannot change their allocations. Primary inventory remaining after the final unit is the locked unsold reserve.

Do not claim the entire event's settlement is one database transaction. Do not reveal a partly completed result or allow trading until every team unit is complete, all reservations have been released, and reconciliation passes. If the settlement job fails, retain the lock and resume or repair it; do not silently start the next phase.

Publish actual funding, allocated shares, and unique backing-team counts after completion. The unsatisfied-demand figure may also be shown after completion, clearly labeled as requested support rather than money raised. Oversubscription is not additional capital.

## 5. Secondary trading: deterministic pools

Each active project has one constant-product pool. At opening, it contains 400 shares and 4,000,000 credit minor units. These are explicitly seeded by the event system, not raised from participants. There is no human market maker and no participant liquidity-provider role.

Let:

- `x` = current pool share reserve, a positive integer;
- `y` = current pool cash reserve in credit minor units, a positive integer;
- `q` = requested whole shares, a positive integer.

For a buy:

```text
require q < x
costMinor = ceil(y × q / (x − q))
poolShares' = x − q
poolCashMinor' = y + costMinor
walletCashMinor' = walletCashMinor − costMinor
positionShares' = positionShares + q
```

For a sell:

```text
proceedsMinor = floor(y × q / (x + q))
poolShares' = x + q
poolCashMinor' = y − proceedsMinor
walletCashMinor' = walletCashMinor + proceedsMinor
positionShares' = positionShares − q
```

Reject a trade that violates a wallet balance, a holding bound, issuer status, phase gate, cooldown, trade allowance, or reserve invariant. Reject any transaction with a zero credit amount. A sell cannot exceed the participant's position. A buy cannot leave the participant above 25 shares. Never partially fill a submitted order; show a new preview for a valid smaller amount.

Use arbitrary-precision integer arithmetic in domain calculations, including intermediate multiplication and ceiling division. Persist validated, safely representable integers in the database. Avoid binary floating-point arithmetic for credits, allocations, or settlement.

For positive integers, `ceilDiv(a,b) = (a + b − 1) div b`. Both trade directions make `x × y` nondecreasing because of rounding. Small rounding residuals remain in the pool and are ledgered through the actual transfer amount. They are not a percentage trading fee.

### Price presentation

The displayed market price is the marginal reserve ratio `y / x`, converted to credits and rounded only for display. It is not the executable price for a block of shares. The trade sheet must show share quantity, total debit or credit, average execution price, and price impact before confirmation.

Do not display a participant's holding multiplied by spot price as cash they could withdraw immediately. A private portfolio may show an **estimated liquidation value** calculated by quoting a full sale of that position against the current pool. This still depends on current reserves and other trades; it is neither guaranteed proceeds nor final contest value.

Do not publish investor rankings during the event, including rankings at interim phase boundaries. An unknown final result and pumpable market marks make them misleading. Show personal liquidation estimates, holdings, cash, completed funding support, and project market activity instead. Investor standings appear only after the final portfolio report is fully published.

### Acquisition cost and realized return

Use a deterministic average-cost method for private portfolio metrics. A position stores `shares`, `costBasisMinor`, and cumulative `realizedPnlMinor`. These fields explain historical spending; they never authorize spending or change the holding cap.

- On a seed allocation or secondary buy, add the actual purchase debit to `costBasisMinor` and the acquired quantity to `shares`.
- On selling `q` shares from a holding of `h` shares with basis `B`, remove `B` if `q = h`; otherwise remove `floor(B × q / h)`.
- Add `proceedsMinor − removedBasisMinor` to `realizedPnlMinor`. Subtract the sold shares and removed basis from the position.
- Keep any fractional-cent allocation remainder in the remaining position. A complete exit always leaves zero shares and zero basis; cumulative realized P/L remains available for history.
- Calculate displayed average acquisition price from `costBasisMinor / shares`, rounding only for display. For zero shares, show no average price.

For example, a three-share position with a 1,001-minor-unit basis allocates 333 minor units of basis to a one-share sale, leaving 668 across two shares. Selling those final two removes all 668. The basis never disappears through repeated display rounding. Final judged scoring does not modify acquisition basis or realized P/L.

### Quotes and concurrent actions

A quote is a preview, not a reservation or a promise that the pool will remain unchanged.

1. The client reads the latest public-safe pool state and its authorized wallet and position state.
2. Shared domain math calculates the preview.
3. The submitted command includes a unique `commandId`, side, issuer, whole-share quantity, `expectedPoolVersion`, `expectedWalletVersion`, `expectedPhaseVersion`, and the displayed price bound (`maxDebitMinor` for a buy, `minCreditMinor` for a sell).
4. The server authenticates the trader and derives their team. Inside the authoritative transaction, it reads the actual event, issuer, wallet, position, and pool state, checks all gates and versions, and recomputes the exact amount.
5. Accept only if versions match, the price bound is satisfied, and all invariants pass. Otherwise reject without any financial mutation and show a refreshed preview.

The client may ask the user to refresh a preview after 10 seconds. This is a usability choice. Security comes from server recomputation, current versions, current roles and statuses, and the real phase deadline. No stored quote document, signed quote, or quote-creation backend call is necessary.

Never automatically resubmit a rejected trade at a new price. A user must confirm the replacement preview. Automatic retries of the **same** `commandId` are safe for recovering an unknown network outcome; they must return the original receipt rather than execute again.

Each accepted secondary trade updates the wallet, position, pool, and one immutable command receipt containing balanced ledger entries. Update the wallet version, per-window accepted-trade count, and last accepted-trade time in the same transaction. No asynchronous trigger is allowed to perform the financial mutation later. Derived displays and analytics can be updated separately and are never trade authority.

### Example: round trip

Starting with `x = 400` and `y = 4,000,000`:

```text
Buy 10 shares:
  ceil(4,000,000 × 10 / 390) = 102,565 minor units = 1,025.65 credits
  pool becomes 390 shares and 41,025.65 credits

Immediately sell those 10 shares, with no intervening trade:
  floor(4,102,565 × 10 / 400) = 102,564 minor units = 1,025.64 credits
  pool returns to 400 shares and 40,000.01 credits
```

Trading with oneself through a pool does not create credits. Other traders can nevertheless be harmed by coordinated trading; see the manipulation section.

## 6. Phase controls and hard boundaries

Use these canonical phase enums:

| Phase | Allowed participant financial actions | Exit condition |
| --- | --- | --- |
| `DRAFT` | None | Organizer completes event configuration |
| `REGISTRATION` | None | Organizer freezes rules and verified teams |
| `SEED_OPEN` | Create, edit, or withdraw own commitments | Hard deadline or organizer closes |
| `SEED_SETTLING` | None | All team allocation units reconciled |
| `INTERMISSION` | None | Organizer opens next configured window or freezes final holdings |
| `TRADING_OPEN` | Validated secondary buys and sells | Hard deadline or organizer closes |
| `FROZEN` | None | Complete judge results confirmed |
| `FINALIZING` | None | Immutable report version fully computed and reconciled |
| `FINALIZED` | None | Read-only final results |
| `ARCHIVED` | None | Read-only archive according to retention policy |
| `CANCELLED` | None | Read-only history; no competition winners |

An emergency pause blocks financial actions while preserving the underlying phase and absolute deadline. Resuming does not silently extend a deadline. If a window has expired, the next permitted transition is to closed. Opening a new window creates a new configured window ID; a pause/resume does not reset anyone's trade allowance.

Every accepted mutation checks the current phase and server time, not a cached browser clock or a scheduler job. The deadline is exclusive: `serverNow < closesAt` is required. Obtain current time again on every database transaction callback retry. An organizer close is an authoritative event-state write; concurrent transactions serialize against that same phase document. A transaction validated just before the deadline can become visible just after it because of network and commit latency; document its server authorization time and do not promise physically instantaneous worldwide closure.

Closing early takes effect at the database serialization boundary. Commands that committed first remain valid; commands that lose the race retry and reject. The organizer cannot revoke a valid completed trade merely because the UI showed it late.

Close trading permanently before final pitches, judge results, or other restricted outcome information is revealed. Staff who can see judge data cannot compete as traders. Never reopen after results become visible. There is no last-minute secret admin trading window.

## 7. Final judging and portfolio scoring

The judging rubric is independent of funding, market price, turnover, and portfolio results. Project teams earn their building award from judges. Teams earn their investing result from the final value of the other projects they selected. "Redemption price" names a scoring rate in the report; it does not mean a payment into a wallet.

Use the approved judge score to rank all eligible projects. Teams with exactly equal aggregate judge scores share a tied rank; avoid an arbitrary cosmetic tie-breaker that changes money. Store the scoring aggregation as a deterministic rational or fixed-precision rule, and use that stored result for ties.

For `N >= 2` eligible projects and an untied rank `r` from 1 through `N`:

```text
redemptionCredits(r) = 175 − 150 × (r − 1) / (N − 1)
```

Round the final per-share value to the nearest credit cent, half up. For a group tied across occupied ranks `a` through `b`, use the average rank `(a + b) / 2` in that formula and round once. Do not first round individual rank values and then average them.

An exact integer formulation in minor units is:

```text
denominator = 2 × (N − 1)
numerator = 17,500 × denominator − 15,000 × (a + b − 2)
redemptionMinor = floor((2 × numerator + denominator) / (2 × denominator))
```

Untied projects set `a = b = r`. A sole eligible project redeems at 100.00 credits/share. If no eligible projects remain, cancel the event. Withdrawn or disqualified projects redeem at zero and are excluded from the eligible ranking. Resolve all statuses before locking the result.

Consequences:

- First place redeems at 175.00; last place at 25.00.
- If all projects tie, all redeem at 100.00.
- If two projects tie for first in a three-project event, they each redeem at 137.50; third redeems at 25.00.
- The mean scheduled issuer payout is approximately 100.00 before cent rounding, regardless of whether judges tend to give high or low rubric scores.
- This is a relative-performance game. A strong project can finish below another strong project; describe the rule before participants commit.

The final portfolio value is:

```text
finalValueMinor = frozenWallet.cashMinor + sum(frozenPositionShares_i × redemptionMinor_i)
profitMinor = finalValueMinor − initialWalletMinor
returnPercent = 100 × profitMinor / initialWalletMinor
```

All funding reservations must already equal zero, so frozen wallet cash equals available cash. Locked project funding is not part of a team's portfolio. Neither unsold primary inventory nor system pool inventory belongs to the issuer's team or contributes to its portfolio score.

For example, 6,000.00 credits in cash, 20 shares redeeming at 175.00, and 10 shares redeeming at 100.00 produce a final value of 10,500.00 credits: a 500.00-credit gain, or 5% on the initial wallet.

Finalization writes an immutable, versioned result report from frozen cash and positions. Preserve the wallet, positions, acquisition basis, realized P/L, pools, and funding vaults exactly as they stood at the final freeze. Create no new credits and retire no shares. Do not sell holdings into the pool or pay the computed score into the wallet. Pool price, available pool cash, and report processing order cannot change the result.

Report generation is resumable and idempotent, keyed by the immutable final-result version and frozen input version. A completed team result records its frozen cash, each share quantity and judge-derived price, calculated final value, and input references. Report records are derived scoring evidence, not financial ledger transfers. Publish final investor rankings only after every eligible team's report is complete and reconciles to the frozen inputs. Equal final portfolio values share the same place; a stable alphabetical display order is not a prize tie-breaker.

Before finalization starts, organizers review the concrete judge score table, ties, exclusions, and derived per-share values. After finalization begins, that result version is immutable. A post-publication correction requires a separately recorded, complete event-level adjudication process and a new explicitly superseding report version; do not silently edit prices, balances, or winners in the MVP.

## 8. Accounting and invariants

Maintain explicit balances for participant cash, issuer funding vaults, pool cash, primary share inventory, pool share inventory, and participant positions. `wallet.cashMinor` includes `reservedSeedMinor`; the reservation is an encumbrance, not an extra cash account. Remaining primary inventory becomes locked unsold inventory when seed settlement finishes, using the same balance rather than creating a second counted inventory. System issuance records identify genesis credit creation. A signed system issuance counter-account is permitted; ordinary participant and pool balances are not negative.

At genesis, for each project and team:

- Issue 10,000.00 credits to the team wallet.
- Issue 40,000.00 credits to the project's system pool.
- Create exactly 500 project shares: 100 in primary inventory and 400 in the pool.

The system pool's 40,000.00 credits are not part of the issuer's wallet, raised funding, or user portfolio. They are declared virtual market infrastructure. With 30 teams, opening cash issuance is 1,500,000.00 credits: 300,000.00 participant credits plus 1,200,000.00 pool credits.

Every financial operation records its actual account deltas with its immutable receipt. Each asset type balances separately. Genesis balances against explicit system issuance entries. After genesis, total `sum(wallet.cashMinor) + sum(issuer.fundingVaultMinor) + sum(pool.creditReserveMinor)` remains constant. Reservations are not added to that sum. Final result reports do not change any of these balances.

Required invariants include:

1. For each project, remaining primary reserve + pool inventory + participant holdings = 500 shares, including after finalization. Primary reserve changes status from sale inventory to locked unsold inventory without being counted twice.
2. Participant cash, share holdings, funding vault cash, and pool reserves never become negative; `0 <= reservedSeedMinor <= cashMinor` always holds.
3. Participant holdings never exceed 25 shares per outside issuer and are always zero for their own issuer.
4. Commitments and reserved cash agree while funding is open; all reservations are zero after funding settles.
5. Every accepted trade moves the exact same credit amount out of one account and into another, and does the same for shares.
6. Primary vault cash equals completed primary allocations multiplied by the fixed primary price. Secondary trades never mutate it.
7. Secondary pool `x × y` never decreases under the stated integer formulas.
8. A command ID identifies at most one accepted outcome. The same key with different command content is rejected, not treated as a fresh trade.
9. A closed phase, inactive issuer, unauthorized actor, stale version, exceeded cap, or invalid amount produces no partial financial state.
10. Final portfolio scores derive exclusively from the locked result version, frozen wallet cash, and frozen participant holdings; generating or retrying reports never changes the financial ledger.
11. Buying increases acquisition basis by the exact debit. A sale removes the deterministic proportional basis; a complete exit leaves zero basis. These historical metrics never gate trading or change credit conservation.

The 15-trade allowance counts accepted buys and sells together, per team, per window. A duplicate retry does not count again. Validation failures do not consume the game allowance. Abuse controls must separately constrain failed requests; these game limits are not a hard backend cost ceiling.

At 30 teams and three windows, the allowance permits 1,350 accepted secondary trades. Four core document writes per accepted trade imply approximately 5,400 financial writes, before funding, settlement, operations, and other application traffic. Platform budget analysis must include those other costs and the event's read model.

## 9. Withdrawals, failures, and refunds

| Situation | Deterministic behavior |
| --- | --- |
| Participant changes a funding request before deadline | Release or reserve the difference atomically |
| Funding oversubscription | Charge allocated shares only; release the rest |
| Issuer withdraws before the immutable allocation manifest is committed | Halt issuer and release all commitments to it; it receives no funds or shares |
| Trade validation fails | No debit, credit, share movement, or accepted-trade count |
| Trade commits but network response is lost | Retry the same command ID and return its existing receipt |
| Browser disconnects during a window | No automatic buy, sell, cancellation, or deadline extension |
| Issuer withdraws or is disqualified after allocation manifest lock | Complete the immutable seed manifest if needed, halt issuer trading, and score its shares at zero; keep historical funding and trades |
| Participant team is disqualified | Freeze its wallet and exclude it from recognition; its issued stock follows the disqualification rule above |
| Judge score is missing or unresolved | Keep final reporting locked until resolved or the project is explicitly assigned a disqualifying status |
| Organizer pauses for a technical issue | Block new mutations, preserve completed transactions and recorded deadlines |
| Whole event must be abandoned | Cancel event and publish no competitive winners; preserve audit history |

An investment in a project that fails to complete can lose its entire game value. Publish this rule before funding. Do not label a current-holder payout at the opening price a "refund": it would not restore past sellers, past buyers, or actual transaction prices.

Do not attempt ad hoc reversal of an already traded project. A sequence of primary purchases, secondary purchases, and secondary sales cannot be undone by editing its current investors' balances alone. Financial corrections require explicit compensating records and a separately designed adjudication policy. The MVP provides pause, resumable settlement, clear disqualification rules, and event cancellation instead of arbitrary balance editing.

## 10. Manipulation limits and honest claims

The chosen mechanism prevents a trader from increasing their final result merely by marking their own holding at a temporarily inflated last price. Final redemption ignores that price. It also prevents an organizer from confusing secondary turnover with real primary support.

It does **not** eliminate collusion. One team can deliberately lose credits to help another through timed pool trades. For example:

1. Team A receives 25 primary shares for 2,500.00 credits.
2. Team B buys 25 shares from the opening pool for 2,666.67 credits.
3. Team A sells its 25 shares for 2,666.66 credits.
4. If the share eventually redeems at 100.00, A gained 166.66 and B lost 166.67. The pool retained 0.01.

No direct transfers occurred, yet value moved between teams. Fees, order books, or call auctions do not automatically solve coordinated subsidized trades either.

Use practical controls:

- Equal wallets tied to verified teams; frozen membership; no extra user wallets.
- No self-stock trading or direct transfers.
- The fixed 25-share holding cap, 15 accepted trades per window, and 10-second cooldown.
- Sealed funding and final judging data kept unavailable until trading permanently closes.
- No pre-final public investor ranking, and no public live buyer/seller identities that make copying trivial.
- Private, immutable trade history for each team and complete event-staff audit access.
- Read-only audit flags for repetitive opposing round trips, concentrated reciprocal funding, and consistently subsidized trading. Flags prompt human review; they are not automatic proof of cheating.
- Separate judged build recognition from market-game recognition. Keep investing and funding rewards low stakes during the first event.

Do not market this as manipulation-proof or as an objective measure of project quality. It is a structured social prediction game. Popularity, marketing, friendships, information access, and strategic play will influence its prices.

## 11. Mechanisms considered and deferred

| Mechanism | Strength | MVP problem | Decision |
| --- | --- | --- | --- |
| Fixed-price funding only | Easy to explain, simultaneous allocation, clean raised-funding accounting | No exit or evolving price discovery | Use once for primary funding |
| Continuous limit-order book | Familiar exchange mechanics and participant-to-participant trades | Thin markets can produce no fills, stale quotes, wide spreads, and significant order-management UX | Defer |
| Batch call auction | Makes discrete windows explicit and can reduce submission-speed advantages | Needs credible two-sided interest; clearing-price, partial-fill, and cancellation rules add complexity; some teams may wait an entire window and get no trade | Revisit for larger events with demonstrated liquidity |
| Issuance bonding curve | Always-on quotes without another human counterparty | Mixes new issuance, reserve cash, funding claims, dilution, and final payout accounting | Defer |
| Seeded constant-product pool | Immediate deterministic quotes, bounded entities, simple atomic accounting | Virtual reserve needs honest labeling; price impact and collusion still matter | Selected secondary mechanism |

The seeded pool does not mint a new share whenever someone buys. It trades a fixed inventory. Its virtual cash is event-created, explicitly accounted for game currency.

Do not build multiple share classes, successive discounted funding rounds, dilution, dividends, cap-table ownership claims, liquidity-provider rewards, shorting, loans, options, limit orders, automated trading bots, live public portfolio profit rankings, or real-money payouts in the first version.

A second funding round should only be added after answering who owns the new shares, whether supply dilutes existing holders, where new proceeds go, how its price is set, and whether final redemption economics remain fair. A new trading window needs none of that complexity.

## 12. Implementation verification required

Tests should verify financial invariants and real failure modes, not only reproduce displayed examples:

- Property tests over buys and sells: credit/share conservation, reserve positivity, holding limits, nondecreasing product, exact integer bounds.
- Round-trip checks, including the 10-share example and random valid reserves; an isolated identical-quantity round trip cannot generate a profit.
- Pro-rata allocation with undersubscription, oversubscription, equal remainders, zero requests, and repeated recovery; allocation sum and refund correctness.
- Concurrent purchases against one pool, simultaneous members spending one wallet, duplicate command retries, and the same ID reused with altered content.
- A close or pause racing a trade, expired deadlines with stale clients, transaction retries crossing a deadline, and phase revisions preventing stale execution.
- Trade quota, cooldown, self-investment, role, issuer withdrawal, and disqualification enforcement on the server.
- Rank payouts for 1, 2, 3, 10, and 30 eligible issuers; all tied, partial ties, exclusions, cent rounding, and invalid result snapshots.
- Interrupted funding settlement jobs resumed repeatedly with identical final balances and receipts; one team unit commits all of its allocations or none.
- Interrupted final report jobs resumed repeatedly with identical versioned scores and no financial mutations, including preservation of frozen cash, shares, and acquisition basis.
- Partial-sale average-cost rounding, repeated sales, and complete exits; allocation of removed basis always reconciles to the acquisition total.
- Emulator-level authorization tests proving clients cannot write wallets, pools, positions, funding vaults, command receipts, judge results, or another team's commitments directly.
- Simulated concentrated, dispersed, inactive, and collusive participation at 10–30 teams to evaluate the proposed reserve depth and game pacing before a live event.

Operational tests and simulated gameplay are prerequisites for claiming the design works in practice. This document defines the intended rules; it does not imply that any implementation or simulation has already passed.
