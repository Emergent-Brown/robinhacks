# Experience and interface design

Status: proposed product specification. [Market rules](02-market-rules.md) owns pricing, scoring, limits, and settlement; this document owns how participants understand and use them. Screen examples illustrate those rules; they do not define additional game rules.

## 1. Design intent

The app should feel like a well-run demo day with a small market attached. Participants are here to build, meet other teams, and make a few considered investments. They should be able to browse a project while standing beside its demo, discuss it with teammates, and finish a trade in under a minute.

The visual direction is precise, quiet, and contemporary: generous space, strong typography, compact rows, a single bright accent, and clear transaction receipts. A project earns attention through its idea and progress. Avoid a wall of numbers, stock-terminal decoration, animated tickers, glass panels, giant gradients, fabricated activity, or aspirational taglines.

The supplied [early design reference](https://claude.ai/code/artifact/2d526547-60cc-4849-b8f8-188ff89c64c3) was reviewed in an in-app browser. It uses a pale blue background, white project cards, blue actions, four bottom tabs, and an investment sheet. Keep its approachable project pitches, familiar navigation, and focused transaction sheet. Replace large dollar-denominated funding totals, money-per-hour statistics, volume-driven stage badges, and compulsory-spending banners with clearer game information. Its additive, irreversible investment flow needs to become two distinct flows: editable seed commitments, then actual buying and selling during trading windows. The organizer view should prioritize phase controls and real exceptions over a dense wall of KPIs and compliance bands.

Design for 10–30 teams and up to approximately 150 people in one event, with a phone as the primary device. One team owns one shared portfolio. Access to the portfolio and permission to spend from it are distinct. Use the event's actual name; no final product name or third-party brand treatment is assumed.

### Principles that resolve design choices

1. **Projects before prices.** A team name and plain-language project description appear before its market statistics.
2. **One obvious next action.** The current phase determines the action: join, browse, edit seed commitments, trade, wait, or view results.
3. **Explain the money once, label it everywhere.** Use `credits`, `shares`, and `team portfolio` consistently. Do not use `$`, real currency symbols, or investment-return promises.
4. **Shared ownership is visible.** Every trade review identifies the team whose balance changes and the person submitting it.
5. **Completed means committed.** A success state requires a confirmed server receipt. A loading animation is never proof of a trade.
6. **Keep the hackathon in the foreground.** The app should work well for brief check-ins; it should not reward staring at a price chart.

## 2. Navigation and screen hierarchy

Use four persistent destinations on mobile. Labels remain visible; icons supplement them. On desktop the same destinations move to a small top navigation bar. The selected event is stable across routes.

| Destination | Primary question | First content | Main action |
| --- | --- | --- | --- |
| Explore | What are other teams building? | Search and project list | Open a project |
| Portfolio | What does our team own? | Team name, available credits, holdings | Review a holding |
| Standings | How is the event going? | Clearly named ranking and its basis | Change ranking |
| Team | What should we share, and who can act? | Our project, membership, permissions | Update project or manage roles |

Additional routes are a project detail, trade review/receipt, event rules/schedule, account, and administration. They do not become more permanent tabs. The account control is in the header. Admins get an `Admin` link there and a separate navigation shell; ordinary participants never see disabled admin controls.

Suggested route shape, to make direct links and QR codes first-class:

```text
/join/:eventCode
/events/:eventId/explore
/events/:eventId/projects/:teamId
/events/:eventId/portfolio
/events/:eventId/standings
/events/:eventId/team
/events/:eventId/trades/:receiptId
/events/:eventId/rules
/events/:eventId/admin
```

Routes are navigation identifiers, not permission boundaries. A receipt URL must still enforce access to its team. A shared project URL must not expose a team's private cash, portfolio, member email addresses, or unpublished drafts.

### Persistent event context

Under the header, show one compact phase bar containing the phase name, status in words, and next relevant time. Tapping it opens the schedule and rules. Do not repeat the event state in several cards.

Examples:

- `Seed round · Commitments open · Closes 2:00 PM`
- `Trading 1 of 3 · Open · Closes 4:30 PM`
- `Build time · Trading closed · Next round scheduled 7:00 PM`
- `Trading paused · Updates from the organizer`
- `Event complete · Final results`

Dates/times use the viewer's locale, with the event timezone explicit on the full schedule and anywhere ambiguity is possible. If the administrator must open a phase manually, label its future time `scheduled`; the timer reaching zero does not promise that trading has opened. A server-enforced deadline can be labeled `Closes`.

## 3. First visit and team membership

The join path has three short steps:

1. **See the event.** Event name, organizer-provided date, one sentence explaining the game, and `Join event`. Sign-in is required to browse participant projects in the first release.
2. **Sign in and join the assigned team.** Use an organizer-issued invitation or an approved membership flow. A public team list is not enough authority to claim a team wallet. A pending request shows `Waiting for approval`, the user's permitted profile draft, and event rules. Market browsing and portfolio access begin only after membership approval.
3. **Understand the shared wallet.** Show the team name, starting credits, their role, and three game rules drawn from the event configuration. End with `Explore teams`.

Suggested onboarding copy:

> Your team shares 10,000 event credits. Back other projects in the seed round, then buy and sell shares during trading windows.

Then show three short facts: `You can't buy your own team's shares.`, `Hold up to 25 shares in any other team.`, and `Judges' results determine final share values.` The seed screen separately explains its optional 50-share total cap at 100 credits per share. Link `How the game works` to the full rules. Do not invent an instructional carousel or require participants to read a long legal-style disclosure before exploring.

Everyone gets a personal sign-in. Before seed funding opens, the captain may designate one additional trader; both can submit seed commitments and trades. Membership and trader changes after seed opens require an organizer and an audit entry. Members without trading permission see holdings and team activity, with a concise explanation at the trade entry point: `Your captain and designated trader can place trades.` Do not make the same balance look like a personal account. Organizers/admins do not compete. Defer unauthenticated spectator access from the first release.

If someone belongs to multiple events, event switching lives in the header menu. Do not add multi-team wallet switching within an event in the first release.

## 4. Explore: help people discover projects

### Default view

Start with `Explore teams`, a search field, and a simple list. Each row contains:

- Team/project name and optional short symbol.
- A human-written, one-line description, limited to roughly 90 characters at authoring time.
- One optional project category; no tag cloud.
- A secondary market datum appropriate to the phase, such as current marginal share price; during the seed round the uniform `100 credits/share` can appear once above the list.
- A small `You own shares` label when relevant.

The entire row opens the project. Do not embed `Buy` buttons in every list row: participants need enough context before placing a trade, and nested row controls complicate mobile interaction.

Offer `All teams` and, if inexpensive to maintain, `Saved`. Saving is a private personal bookmark, not a vote or public signal. Search covers the project name and description. For 30 teams, pagination and a complex filter drawer are unnecessary; use a modest, bounded list with accessible rows.

Default order should give every team a chance to be seen. Use a stable, seeded permutation for each participant for the event; preserve it across visits and paginate consistently if the event grows. Offer `Name` as an explicit alternative. Popularity ordering belongs in Standings, not the default discovery screen. Do not move rows while someone is reading because prices update.

### Information density

At a typical 390-pixel phone width, aim for three to four readable project rows beneath the header and phase bar. A row should remain useful without a project image. If images are added later, a small thumbnail is enough; avoid image-dominated cards that make comparing 30 projects slow.

Do not put portfolio value, prize pools, investor rankings, trending teams, a news feed, and a market chart above the project list. Those items already have better homes.

### Mobile wireframe

```text
┌──────────────────────────────────┐
│ EVENT NAME                 Alex ○│
│ Trading 1 · Open · Closes 4:30 PM›│
├──────────────────────────────────┤
│ Explore teams                    │
│ [ Search projects              ] │
│ All teams    Saved       Name ▾  │
│                                  │
│ Orbit                        100 │
│ Find empty study rooms nearby    │
│ Campus              credits/share│
│ ──────────────────────────────── │
│ Patch                        100 │
│ Turn bug reports into test cases │
│ Developer tools                  │
│ ──────────────────────────────── │
│ Moss                         100 │
│ Plan meals from what's at home   │
│ Food                             │
├──────────────────────────────────┤
│ Explore  Portfolio Standings Team│
└──────────────────────────────────┘
```

The wireframe expresses hierarchy, not literal font sizes or validated pricing. Labels must remain legible; do not reproduce its narrow right-aligned annotations when real text requires a second line.

## 5. Project detail: enough evidence to make a decision

Use the same template for every team. Present the following in order:

1. Project name and one-line description.
2. `View demo` or `View project` if a valid link exists; show the destination domain.
3. A short explanation: `Problem`, `What we're building`, and `Progress`. Each field should have a sensible authoring limit, around 300 characters; allow a little more for the build description if needed.
4. Latest checkpoint update and its actual timestamp.
5. Market section: current marginal share price, settled seed funding, and the viewer's holding if any. `Seed backers` is secondary detail after seed publication.
6. An expandable explanation of the market metric and game mechanics.

Place a sticky `Set seed commitment` or `Edit seed commitment` action during the seed round, and `Buy shares` during open secondary trading, near the bottom of the viewport above safe-area spacing and without covering content. If the team already holds shares during secondary trading, provide a secondary `Sell` action. Project pages can hide the persistent tab bar while the action bar is present, using a clear back control and preserving the previous list scroll position.

For the participant's own project, the action becomes `Edit project` for permitted users. Show `Teams can't buy their own shares` in the market area only when useful; no disabled buy button is necessary.

For closed or paused phases, keep project information visible and replace the trade action with a short status and schedule link. Preserve the market section as a historical snapshot with its timestamp.

### Separate the different meanings of money

These terms must never be presented as interchangeable:

| Label | Meaning shown to the participant | Presentation rule |
| --- | --- | --- |
| Share price | Current marginal price from the project's system liquidity pool | Does not imply a multi-share order fills at that price |
| Trade total | Exact quoted credits paid or received for this order | Includes the required integer rounding; trading fees are zero |
| Seed backers | Distinct teams that received primary shares in the completed seed allocation | Derived from the immutable seed manifest; later trades do not change the count |
| Seed funding raised | Credits actually settled into the project's locked funding vault | Seed commitments and secondary trade volume do not count; the project cannot trade with this vault |
| Estimated liquidation value | Available credits plus exact full-position sell calculations using reserves from the displayed market snapshot | Show the snapshot time; an estimate, not guaranteed proceeds or the final contest result |
| Final portfolio result | Frozen cash plus holdings scored at independently judged final share values | Ignore final market price; explain the announced final share-value rule |

Trade volume is not funds raised. Share price is not project quality. Seed backing is not the cash a seller could receive. Market-derived numbers should not be labeled `valuation` unless the rulebook defines that number and makes its fictional meaning clear.

### Project updates

Start with one short update per checkpoint rather than an infinite social feed. A useful prompt is `What changed since the last round?` An update can include one demo link. If project updates are frozen for a round, show the next editing opportunity. Distinguish draft content from published content and show a preview before publishing changes.

Do not auto-generate flattering descriptions, infer project quality, or show a `Verified` badge just because a URL was provided. A missing demo reads `Demo link not added`.

## 6. Seed commitments: back ideas before seeing demand

The seed round is a separate experience from secondary trading. Every share costs 100 credits. Each team may commit up to 5,000 of its 10,000 starting credits, or 50 shares in total, with at most 25 shares requested from any one other project. There is no minimum spend. Do not show a warning that unused credits are a failure.

During `SEED_OPEN`, a project action opens `Set seed commitment`. Show the fixed price, a whole-share quantity, the resulting commitment in credits, and the change to the team's available and reserved balances. Confirming reserves those credits immediately; it does not grant shares yet. The team can add, edit, or withdraw commitments before the server-enforced close. A zero-share commitment means withdrawal and shows the credit amount being released.

The Portfolio screen temporarily leads with:

```text
Team Mosaic · Seed round

Available credits                7,000
Reserved for funding             3,000
Total wallet                    10,000

Seed commitments
Orbit       20 shares requested  2,000 credits
Patch       10 shares requested  1,000 credits

30 of 50 shares committed
Editable until 2:00 PM EDT
```

Use `requested`, not `owned`, and `reserved`, not `spent`. Each row offers `Edit` for permitted roles. Team members can see their shared commitments. Other teams cannot see them. Public funding totals, investor counts, backers, demand rankings, and activity-derived hints stay hidden until all seed allocations are settled and published.

The review includes this plain-language rule:

> If a project receives more requests than its 100 seed shares, shares are allocated proportionally. Unused credits return to your team's balance.

Link to the exact whole-share rounding and precommitted tie-resolution rule. Do not put allocation math in the main form. A commitment can receive fewer shares than requested; no speculative `You will own X%` label appears before allocation.

On close, show `Seed commitments are closed. Allocating shares…` during `SEED_SETTLING`. Disable edits and reconcile any pending command. Once settlement publication completes, each team gets a compact allocation receipt: requested shares, received shares, actual credits spent, and credits released for every project. Public project pages can then display `Seed funding raised` and `Seed backers`. Partially completed settlement must not reveal aggregate results early.

Shared-wallet concurrency and uncertain submissions follow the same contract as trading: versions prevent overwriting a teammate's newer commitment, a stable request identifier prevents duplicates, and a timeout remains pending until resolved. Do not show a saved commitment before its reserve change is confirmed.

## 7. Secondary trade flow: clear, deliberate, recoverable

Use a route-backed full-height sheet on mobile and a restrained modal on desktop. Both share one form and state machine. Refreshing or navigating back should recover enough context to see the project and, if a submission started, its receipt status.

The flow is `Enter amount → Review trade → Confirmed receipt`. Do not require a second review of the same information or a ceremonial swipe to confirm.

### Entry

- Title: `Buy Orbit shares` or `Sell Orbit shares`.
- Account: `For Team Mosaic`.
- Editable whole-share quantity. The maximum total position is 25 shares per other project. It is a share-count cap, not a limit of 25% of portfolio value.
- Numeric keyboard, visible label, stepper controls with usable touch targets, and an available balance or holding count.
- Review uses a fresh quote: share quantity, total cost/proceeds, and balance after the trade. The constant-product pool changes price across the order, so explain the total rather than multiplying quantity by the headline marginal price. There is no trading fee.
- Small supporting text for any applicable position limit.
- Primary action: `Review buy` or `Review sale`.

If a spend-budget input is preferred in a later version, the quote service must resolve it to the actual share quantity and remainder before review. Do not offer both budget and share inputs in v1 without a clear reason.

### Review

The review gives one readable sentence and the numbers required to verify it:

```text
┌──────────────────────────────────┐
│ ‹ Back               Review buy  │
│                                  │
│ Buy 10 Orbit shares              │
│ For Team Mosaic                  │
│                                  │
│ Total             1,025.65 credits│
│ Balance after     8,974.35 credits│
│ Average price     102.57 cr/share │
│ Price impact              +2.57% │
│                                  │
│ Submitted by Alex                │
│ Quote updated just now           │
│                                  │
│ [ Confirm purchase             ] │
└──────────────────────────────────┘
```

The total and post-trade balance are the primary numbers; average execution price and price impact are supporting rows. In the actual screen, spell out `credits/share` instead of the wireframe's space-saving abbreviation. The example is a 10-share buy from the initial pool, rounded up to the nearest credit minor unit (0.01 credits). Average price is rounded for display; the exact total remains authoritative. Price impact here compares the average execution price with the starting marginal price. Values in the actual interface come from the authoritative pool snapshot and shared accounting implementation.

The quote UI refreshes after 10 seconds and disables its old confirmation. This is an interaction rule, not the authority for whether trading is open. Execution requires the reviewed pool and wallet versions to still match; any change requires a fresh review. The server independently checks phase, deadline, permissions, cash, holdings, and limits. A stale quote never silently widens the accepted price.

The per-window limit is 15 accepted trades per team, with a 10-second team-wallet cooldown between accepted trades. Explain these in the rules and show the remaining count in trade detail when relevant. During cooldown, show `Your team can trade again in [n] seconds` without a flashing timer. Rejected or stale requests do not consume the accepted-trade limit. Do not present either limit as a progress target to complete.

### Submission and receipt

On confirm, disable duplicate submission and send one stable request identifier. Show `Submitting…`. The user may safely leave the sheet; the app must still reconcile the request when they return. The receipt records team, actor, project, direction, shares, total, server timestamp, round, and transaction identifier. The team portfolio activity links back to it.

Success copy: `Bought 10 Orbit shares for 1,025.65 credits.` Actions: `View portfolio` and `Done`. This is enough celebration. A subtle checkmark is preferable to confetti, sounds, or a fake price surge.

### Error and uncertain-state contract

| State | Visible message | Safe action |
| --- | --- | --- |
| Quote changed before commit | `The quote changed. Review the new total.` | Show old and new totals, require a new confirmation |
| Insufficient shared balance | `Your team's balance changed. Update this trade.` | Refresh balance and quote, preserve entered quantity |
| Position limit exceeded | `This trade exceeds your team's limit for Orbit.` | Show allowed amount from server response |
| Window trade limit reached | `Your team has used its 15 trades for this window.` | Show the next scheduled window |
| Team wallet cooling down | `Your team can trade again in [n] seconds.` | Refresh the quote after the cooldown |
| Round closed | `Trading closed before this trade completed.` | Return to project with current phase; only use this text for a definitive rejection |
| Event paused | `Trading is paused by the organizer.` | Keep entered quantity locally; require fresh quote on resume |
| Permission changed | `You no longer have trading access for this team.` | Read-only project and link to team roles |
| Definite rejection | `Trade wasn't placed.` plus a specific reason | Edit or start a new submission |
| Timeout or connection lost after submit | `Checking whether your trade completed…` | Resolve the same request identifier; do not invite a new duplicate trade |
| Still unresolved | `Trade status is still pending. You can check it in your portfolio.` | Persistent pending entry with request reference |
| Offline before submit | `You're offline. Reconnect to trade.` | Browse cached content with timestamp; disable submission |

The distinction between rejected and unknown is essential. A timeout must not be labeled a failed trade if the server might already have committed it. Never queue financial game commands as offline Firestore writes to be replayed later.

## 8. Portfolio: a team-owned decision record

The heading is `Team Mosaic portfolio`, not `Your balance`. After seed settlement, the first region contains available credits and `Estimated liquidation value`, with its basis and snapshot time visible nearby. Calculate the estimate locally from available credits and the exact full-position sell math using reserves in the displayed two-minute market snapshot. Do not fetch every holding's pool afresh to render this estimate; only an actual trade review reads its specific pool. Other teams' trades can change those proceeds, so it is neither guaranteed cash nor the eventual judged result. The project's locked seed funding vault stays out of its tradable wallet and portfolio result. There are no recurring fresh-credit allocations in the recommended first event.

After finalization, show `Final portfolio result` with frozen cash and each holding's quantity, judged final share value, and score contribution. This is a score report; publishing it does not mint spendable wallet credits or remove shares. Link to the independent judging, final share-value, and tie rules. The final market quote does not determine the result. Explain that before anyone commits credits, not first at the results screen.

Below that, show holdings as rows:

| Project | Required information |
| --- | --- |
| Orbit | Shares owned; value under the announced marking rule; secondary cost basis if supported |
| Patch | Same structure; tap opens project and holding detail |

Use at most two numerical columns on mobile. Expand details on tap. A desktop table may additionally show average cost and unrealized change if those values have a clear definition in the rulebook. Do not show a percentage return until new allocations, sales, and cost basis are handled correctly.

The second section is `Team activity`: chronological confirmed receipts, seed reserves/releases, seed allocations, and unresolved submissions. Each action shows its actor. This answers `Did someone else on my team already buy this?` without forcing teammates into chat or exposing their portfolio to competing teams.

An empty portfolio says `Your team doesn't own any shares yet.` with `Explore teams`. Closed trading adds a schedule fact below it. Avoid `Start your journey`, fake example holdings that look live, and empty charts.

### The investment sheet

Within a holding or project detail, include an expandable `Team notes` section with three short fields: `Why we backed it`, `What would change our mind`, and `Next thing to check`. Only the first is the primary prompt; the others are optional. Position, cost, and confirmed trade history come from the ledger and do not require manual entry. These notes are private to the team. All approved team members may read and edit them; show the latest author and timestamp and detect concurrent changes rather than silently overwriting a teammate's edit.

The Portfolio screen also provides `Download portfolio CSV` for holdings, cost, and available results, with confirmed activity export accessible alongside the activity list. This is the initial `investment sheet`: structured notes, reliable accounting, and an export. It does not introduce a fifth navigation destination or an embedded spreadsheet editor.

## 9. Standings: make the contest legible

Use a small ranking switcher with only rulebook-supported categories:

- **Investors:** available only after final judging and result publication, ranked by the final portfolio result. Before then, show `Investor results will be available after judging.` Do not publish interim investor rankings or winner badges from market prices.
- **Seed funding:** teams ranked by credits settled into their locked funding vaults. This is a completed seed-round result, hidden until seed publication.
- **Judges:** independently entered final judging ranks after publication. Show the corresponding final share values and ties; judges must not be instructed to rank from the market leaderboard.

Project detail may show the immutable `Seed backers` count. Defer current-holder backer counts and an additional backers ranking in v1. The initial three standings views above cover investor results, actual simulated fundraising, and the independent judging outcome without duplicating similar popularity statistics.

Each view shows rank, team name, its own score label and units. The user's team can have a subtle outline; do not pin it twice in a short list. State tie behavior in the rules and render tied ranks honestly. A participant should never need to infer whether they are competing as a builder, investor, or popular project.

Seed funding standings publish once the entire seed allocation completes; investor and judge standings publish with final results. There are no interim investor snapshots. Each published view has its timestamp and result version. A refresh fetches the latest published result and must not imply a new scoring calculation. When standings are hidden until a milestone, say `Results will be published after [milestone]` and still let approved members explore projects.

## 10. Team workspace

This destination collects a small set of team operations:

- Project profile with `Preview project page` and an explicit publish/save state. Here, published means visible to authorized event participants.
- Settled seed funding summary, labeled `Locked funding vault` with `These credits cannot be used for trading.`
- Members and their roles, with personal email addresses visible only where authorized.
- Pending membership requests/invitation management for permitted roles.
- Current trading permissions and a short explanation of the shared wallet.
- Team's checkpoint update editor when allowed.

Use sections on one page; do not create a nested dashboard for each item. Mobile editing can use focused subroutes. Keep participation identity and project identity separate so a project can be renamed without affecting memberships or positions.

Role changes and invitations require authoritative server confirmation. A role badge changes only after success. Once seed funding opens, replace self-service membership/trader changes with `Contact an organizer to change team access.` If removing the last authorized captain is prohibited, explain that directly. Never rely on hiding a button to enforce permission.

## 11. Phase-aware behavior

Use the following domain phases. Round number and schedule are state data, not additional ad hoc phase names:

| Domain phase | Explore/project | Portfolio | Standings | Main participant action |
| --- | --- | --- | --- | --- |
| `DRAFT` | Organizer preview only | Not available | Not available | Organizer configures event |
| `REGISTRATION` | Draft-aware project browsing | Starting allocation when published | Hidden or explanatory empty state | Join team, complete profile |
| `SEED_OPEN` | Fixed-price commitment entry | Available/reserved credits, private commitments | Seed demand hidden | Edit seed commitments |
| `SEED_SETTLING` | Read-only projects | Locked commitments, settlement pending | Seed results hidden until publication | Wait for allocation |
| `INTERMISSION` | Project/checkpoint browsing | Read-only holdings; next schedule | Seed funding standings | Visit demos, update project |
| `TRADING_OPEN` | Buy/sell enabled for eligible roles | Confirmed holdings | Seed funding standings; no investor ranks | Buy or sell |
| `FROZEN` | Final project evidence | Frozen holdings; result pending | Seed funding standings; final results pending | Wait for judging |
| `FINALIZING` | Read-only projects | Final computation pending | Unpublished final result hidden | Wait for results |
| `FINALIZED` | Read-only project archive | Frozen holdings and final score report | Final rankings | View results |
| `CANCELLED` | Read-only projects with organizer's cancellation reason | Preserved history; no new commands or implied refunds | No competition results or winners | Read cancellation notice |
| `ARCHIVED` | Read-only archive, per retention policy | Preserved history where authorized | Published results only if the event completed | View archived event |

Emergency pause is a boolean overlay with a reason, actor, and timestamp. It prevents participant financial commands while preserving the underlying phase; it does not reset a round or fabricate a new phase. Browsing, confirmed holdings, and reconciliation stay available. Refresh phase and quote eligibility when a backgrounded mobile tab returns to the foreground. Client countdowns are informational; server decisions govern acceptance at boundaries.

When a window closes, close no screens abruptly and discard no participant input silently. Disable submission, explain the new state, and preserve a local draft where useful. Old draft quantities never become automatic trades when a new round opens.

## 12. Administration: operations first

The admin landing page should answer three things immediately: what is running, whether anything needs attention, and what the next organizer action will do.

```text
┌──────────────────────────────────────────────────┐
│ Event admin                       Participant view│
├──────────────────────────────────────────────────┤
│ Trading window 1 of 3                             │
│ Trading open · Closes today at 4:30 PM EDT         │
│                                                  │
│ [ Pause trading ]       Close round…             │
│                                                  │
│ Ready for next round                             │
│ 30 teams · 150 members · 2 profiles incomplete    │
│                                                  │
│ Attention                                        │
│ 1 submission awaiting reconciliation    Review › │
│                                                  │
│ Next: Build time                                 │
│ Trading closed · Project updates allowed         │
│                                                  │
│ Teams  Schedule & rules  Activity  Results        │
└──────────────────────────────────────────────────┘
```

Use actual data; do not build a synthetic `System healthy` badge when there is no underlying health check. Empty attention queues collapse into a short `No actions needed` line.

### Phase controls

- `Pause trading` is easy to find and available on a phone. Pause should be a single deliberate action because delay defeats its purpose; success must still wait for server confirmation.
- `Resume trading` previews the active window/deadline. If the deadline already passed, direct the organizer to the permitted next action.
- `Close round…`, `Open round…`, and `Publish results…` open a focused review with the current state, target state, actual timing, and concrete effect. Destructive or irreversible effects need explicit confirmation within the app.
- An emergency pause can use the default participant message `Trading is paused by the organizer.` Let the administrator add a short reason immediately afterward. Require a reason in the review for a published schedule change.
- Validate prerequisites server-side. Show actionable blockers such as `Seed settlement is not complete` when they prevent the requested transition. A team without an optional second trader is not a blocker; its captain can act.
- Show the latest actor and timestamp. Concurrent administrator changes invalidate the review and require a refresh rather than overwriting newer state.

Suggested close-round review:

> Close trading window 1 now? Completed trades remain. New trade requests will be rejected. The next phase is Build time.

Buttons: `Keep trading open` and `Close round`.

### Other admin screens

| Area | Necessary controls | Keep out of initial interface |
| --- | --- | --- |
| Teams | Approve membership, correct profile, assign permitted roles, inspect team | Arbitrary hidden balance edits |
| Schedule and rules | Draft event setup; preview participant schedule; publish permitted changes | A visual automation builder |
| Activity | Filter audited actions by team, round, actor, request ID; inspect receipt | Raw database JSON as the main workflow |
| Results | Validate settlement readiness; preview results; publish | Manual leaderboard dragging |
| Incident recovery | Inspect unresolved operations and run explicit supported recovery | Generic `Reset everything` next to live controls |

Administrative adjustments, if supported, need an explicit compensating ledger operation with reason and audit history. The UI must not offer an apparently harmless cell editor that changes a team's money behind the accounting model.

Seed settlement and finalization get a compact operation panel: stage, completed team units, total team units, last successful action, and any specific blocker. In the first release, the organizer console drives bounded, resumable processing calls; `Continue settlement` resumes the existing operation if navigation or a connection loss interrupted it. It never starts a second allocation. Show `24 of 30 teams settled`, not a fabricated time estimate. `Publish` remains unavailable until the server confirms all units and reconciliation checks passed. Participants see only the current pending state until the entire result version is published.

Admin must work at 390 pixels for phase operations and incident triage. Large CSV imports and full ledger analysis may be more comfortable on desktop, but mobile should never hide the emergency pause control behind a wide table.

## 13. Visual system proposal

Use a light interface for the first event. It is readable in bright rooms and on a projector. A restrained dark theme can follow after the core interface is validated; do not double the visual QA surface prematurely.

| Token | Initial value | Purpose |
| --- | --- | --- |
| `color.canvas` | `#F5F6F2` | Soft off-white page background |
| `color.surface` | `#FFFFFF` | Forms, sheets, selected panels |
| `color.text` | `#151A17` | Main text |
| `color.textMuted` | `#566159` | Supporting text; still readable |
| `color.line` | `#D6DDD6` | Decorative separators |
| `color.controlBorder` | `#7C887F` | Input boundaries where required |
| `color.accent` | `#CAFF5C` | Small active highlights and primary button fill |
| `color.onAccent` | `#172008` | Text on accent |
| `color.focus` | `#245DD8` | Keyboard focus ring |
| `color.positive` | `#21663B` | Positive numbers paired with a sign/label |
| `color.negative` | `#A52B2B` | Errors or negative values paired with text |
| `color.warning` | `#785000` | Paused/pending status text on light surfaces |
| `font.body` | System sans-serif stack | Fast loading and familiar mobile forms |
| `font.numeric` | Body font with tabular numerals | Stable aligned quantities |
| `space` | `4, 8, 12, 16, 24, 32, 48` px | Consistent rhythm |
| `radius.control` | `10px` | Buttons and inputs |
| `radius.sheet` | `16px` | Desktop dialog/mobile sheet top corners |
| `size.control` | At least `44px` high | Main touch controls |
| `layout.pageMax` | `1120px` | Desktop content width |
| `layout.readingMax` | `680px` | Project story, forms, rules |

These are design candidates, not a verified contrast audit. Check the final rendered combinations, hover/disabled states, chart colors, focus boundaries, and any event branding before launch. The pale divider token is decorative; it must not be the sole visible boundary of a required control.

Typography: 16px body with about 1.5 line height; 14px for secondary metadata; 28–32px page titles on mobile; 36–44px for a single primary total when useful. Avoid 10–12px financial labels and all-caps paragraphs. Use sentence case. Large amounts use tabular numerals and locale-aware grouping; internal credit precision follows the accounting specification.

Desktop may use two columns for a project story and market panel. Mobile is a single column. At 320px, controls wrap and text reflows without horizontal page scrolling. Tables turn into labeled rows where practical; a necessary data table gets a contained scroll region and visible headers.

Motion is short and functional: about 120–180ms for a sheet or selection transition. Respect reduced motion. No auto-scrolling tickers, pulsing deadlines, sound effects, continuous number rolls, or full-list movement on price updates. Charts, if introduced, show actual snapshots as steps when that matches the data; never smooth them into a fabricated continuous history.

## 14. Accessibility and poor-connection behavior

Target WCAG 2.2 AA as a release requirement. W3C's minimum pointer-target criterion is generally 24×24 CSS pixels with defined exceptions; this product adopts a larger 44×44 target for principal controls. Text needs at least 4.5:1 contrast, with 3:1 for qualifying large text. Follow the actual criteria when evaluating the finished UI. Sources: [W3C target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [W3C text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

Implementation acceptance criteria:

- Keyboard users can join, browse, place a trade, inspect a receipt, and administer a phase without traps. Dialog focus is contained while open and restored to the trigger when closed.
- Inputs have visible labels and programmatic associations. Quantity errors are attached to the input. Do not rely on placeholder text.
- Gains, losses, open/closed status, and selected controls use words, symbols, or shape as well as color.
- Status messages are programmatically announced without moving focus unnecessarily; announce confirmed trades and actionable errors, not every price tick. See [W3C status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
- Bottom navigation and sticky actions account for phone safe areas, software keyboards, zoom, and focused controls. No action bar covers the last row or a focused input.
- Layout works with 200% text resizing and at a 320px viewport. Test real browser zoom and device font scaling; do not disable pinch zoom.
- Any chart has a textual summary and equivalent values. No information exists only in a hover tooltip.
- Loading placeholders preserve layout and have finite scope. If data is slow, show `Loading portfolio…` and an accessible retry after a real error.
- Cached data is labeled `Saved [time] · Offline`. A cached open-phase badge must never make offline trade submission available.
- Pending submissions survive navigation and can be reconciled on reconnect. Store the minimum local request metadata needed for recovery; avoid retaining another team's private data on a shared device after sign-out.

Operationally, refresh only the views in use and reuse event context. Explore uses a compact market projection refreshed about every two minutes during trading windows and at phase boundaries, with a caption such as `Updated 2 min ago`. A trade review reads the specific pool afresh; the older Explore price is not executable. Ordinary members fetch their private team portfolio on entry or manual refresh. Active captain/trader views may subscribe while visible; unsubscribe when hidden. The cost plan assumes one active trading view per team and does not promise live updates on all five teammates' devices. Avoid one live listener per project row or a timer-triggered fetch every second.

## 15. Copy rules and approved examples

Use direct labels and specific facts. No AI-written hype or pseudo-financial expertise. Use the team/project name when it removes ambiguity, and `your team` when ownership matters.

| Situation | Copy |
| --- | --- |
| Event introduction | `Back other teams with event credits.` |
| Available cash | `Available credits` |
| Shared portfolio label | `Team Mosaic portfolio` |
| Seed request saved | `Requested 20 Orbit shares. 2,000 credits reserved.` |
| Seed commitment withdrawn | `Commitment removed. 2,000 credits released.` |
| Seed oversubscription receipt | `Received 15 of 20 requested shares. 500 credits returned.` |
| Trading open | `Trading open until 4:30 PM` |
| Between rounds | `Trading is closed. The next round is scheduled for 7:00 PM.` |
| Pause | `Trading is paused by the organizer.` |
| No search matches | `No projects match “[query]”.` |
| No holdings | `Your team doesn't own any shares yet.` |
| No submitted demo | `Demo link not added` |
| Save project draft | `Draft saved` |
| Profile published | `Project updated` |
| Trade receipt | `Bought 10 Orbit shares for 1,025.65 credits.` |
| Shared-wallet conflict | `Your team's balance changed. Update this trade.` |
| Pending outcome | `Checking whether your trade completed…` |
| Final results pending | `Trading has ended. Final results are being prepared.` |
| Scores revealed | `Final results` |

Avoid `Fuel innovation`, `Discover the next unicorn`, `Your investment journey`, `Smart money`, `AI-powered insights`, `High-potential team`, `Guaranteed`, and `To the moon`. Do not invent urgency or investment advice. Let the event's projects and real results supply the character.

## 16. Initial scope and validation

### Include in the first playable event

Team invitation/membership; project directory and details; private editable seed commitments and allocation receipts; shared portfolio with private team notes and CSV exports; quote/review/receipt buying and selling; phase and pause states; simple standings; team roles; admin phase control, resumable settlement, and audit inspection; published rules and schedule; robust reconnect behavior; accessible mobile layouts.

### Defer until real participant feedback warrants it

Candlestick charts, order-book screens, chat, personal portfolios, direct messages, user-generated reactions, push notifications, continuous news feeds, prediction AI, portfolio optimization, embedded spreadsheets, rich pitch decks, video hosting, public trade-by-trade social feeds, live spectator walls, custom avatar systems, multiple themes, and elaborate sound/animation packages.

Personal bookmarks are a small optional improvement, not a blocker for the first event. A spectator display should eventually use its own intentionally sparse layout rather than projecting the mobile app.

### Pre-event usability rehearsal

Use a small group of people who have not read the specification. Ask them to complete these tasks on their own phones:

1. Join the correct team and explain whose credits they can spend.
2. Find a project, describe what it does, distinguish its share price from seed funding raised, and edit a seed commitment without mistaking reserved credits for owned shares.
3. Buy a small holding, locate the receipt, and identify who placed it.
4. Have two teammates attempt overlapping trades and recover from a changed balance.
5. Lose connection after confirmation and determine the trade's actual outcome without duplicating it.
6. Return after the round closes and explain what they can do next.
7. Interpret investor and project standings and say which results are final.
8. As an admin on mobile, pause trading, inspect the effect, and resume or close the round under the actual rules.

Record misunderstandings and completion friction rather than just asking whether the screen looks good. Before launch, require no unresolved issues that obscure shared ownership, acceptance/rejection of a trade, credit units, current phase, or the meaning of a ranking. Run keyboard and screen-reader checks on the same critical paths, plus phone tests at 320px, 390px, and a wide desktop layout.
