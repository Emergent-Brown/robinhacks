# RobinHacks: product brief

> **Historical version-one document (September 8–10, 2026).** This trading proposal/implementation record is preserved for context. [11 · Sealed funding rounds](11-sealed-rounds.md) supersedes its current product rules, lifecycle and architecture. Do not use the old buy/sell instructions for a version-two event.

Status: recommended first-release design, September 8, 2026. This is a product specification, not an implemented application.

## The idea

Every hackathon team builds a project and manages a small investment fund. Teams back projects they believe in, revise their opinions after progress updates, and see how their picks perform against the final judging results.

The game should create conversations: “We backed you early—show us what you built.” It should occupy a few minutes at a checkpoint, leaving the rest of the hackathon for building.

**Recommended format:** one shared wallet per team; one opening funding round; three short trading windows; an independently judged finish. All money and shares are fictional, with no purchase, transfer outside the event, cash redemption, or actual ownership. Display “credits,” not dollars.

## Confirmed constraints and working assumptions

| Item | Basis |
|---|---|
| First event | User confirmed 10–30 teams, up to 150 people |
| Platform | Responsive web application; usable on a phone without installation |
| Infrastructure | User prefers Firebase/Firestore and accepts a billing account while targeting $0 through limited usage |
| Work at this stage | Product, mechanics, design, architecture, and operating documentation first |
| Event length | Assumed 24 hours; the same phase sequence can stretch to 36–48 hours |
| Team size | Assumed 2–5; wallet size is independent of headcount |
| Authority | Organizers approve teams and operate the event; independent judges evaluate projects |
| Brand | RobinHacks is a working name from the reference/workspace, not a final brand decision |

## What participants do

1. Sign in as themselves, join an approved team, and read a short explanation of the game.
2. Publish a team page: one-sentence pitch, problem, working scope, demo/repository links, and an update at each checkpoint.
3. Commit some of the team's 10,000 credits to other projects during a sealed funding round. A team can revise its commitments until the deadline. Spending is optional.
4. After the simultaneous funding reveal, buy or sell shares during announced trading windows. An automated exchange supplies liquidity, so a trade does not depend on another participant being online.
5. Inspect a shared portfolio, privately note reasons for investing, and discuss what changed.
6. After final trading closes, present the project. Independent judging determines the final value of project shares and the investment standings.

See [the complete market rules](02-market-rules.md) for allocation, pricing, caps, and scoring. Numeric rules live there; interface examples must follow them.

## Three different outcomes

| Outcome | What it answers | Treatment |
|---|---|---|
| Project judging | Who built the best project under the published rubric? | Main hackathon award; independent of market prices and fundraising |
| Investment result | Who made the best portfolio decisions? | Separate side-game result; final credits plus judge-based share value |
| Seed backing | Which pitches attracted the most opening support? | Community signal and optional recognition, not a replacement for judging |

Do not blend these into a mysterious composite score. Do not scale the main prize automatically with money raised. Fundraising reflects communication and peer interest; judging reflects the finished project; investing reflects the team's choices and timing. Keeping the measures separate makes each interpretable.

At first, use small symbolic recognitions for the investment game. The software can restrict obvious manipulation, but friends can coordinate outside the app; this should not determine a large material prize without a stronger event policy and review process.

## Why this market structure

**Opening funding is a shared reveal.** A single fixed-price primary round offers equal access and gives teams the experience of raising capital. Sealed commitments prevent a public live leaderboard from driving a pile-on. Pro-rata allocation resolves popular projects fairly.

**Later trading uses a simple automated exchange.** With 10–30 teams, a conventional order book can leave everyone waiting for a counterparty. The exchange holds a known inventory and virtual credit reserve for every project. Buy and sell quotes are immediate; price impact is shown before confirmation.

**Final share value comes from judging.** If the final price determined the winner, teams could manufacture a result by buying each other's shares just before the close. Independent final values remove that direct scoring exploit. They do not eliminate every trading or social manipulation strategy.

Funding proceeds remain in a locked, nonspendable project vault. They never top up that project's investment wallet. Secondary trades move credits between investors and the exchange, and never increase “raised.” This prevents successful fundraising from creating a runaway advantage for that team as an investor.

## Event rhythm

Illustrative 24-hour schedule; durations are configurable before the event starts.

| Relative time | Participant moment | Organizer action |
|---|---|---|
| Before opening | Sign in, form teams, publish pitches | Approve roster, rehearse login, publish rules |
| H+1 to H+1:20 | Read pitches and commit seed investments | Open seed funding, then close and settle |
| H+2 to H+2:30 | First market window | Open trading after funding reveal |
| H+8 to H+8:30 | Progress checkpoint and second window | Publish updates, open trading |
| H+18 to H+18:30 | Last progress checkpoint and final window | Announce clearly that this is the last chance to trade |
| H+18:30 onward | Build and prepare presentations | Permanently freeze trading before judges start scoring |
| H+23 onward | Demos, judging, results | Import/verify scores, preview and publish settlement |

Use the product names **Seed**, **Trading 1**, **Trading 2**, and **Final trading**. Reserve terms such as Series A/B for a future genuine issuance mechanic; arbitrary fundraising badges add little to the first event.

Trading windows should open only after each team has had the same opportunity to publish its update. Avoid opening individual stocks immediately after their demos: demo order would become an investment advantage.

## Roles and ownership

| Role | Responsibilities |
|---|---|
| Organizer | Configure event, approve roster, control phases, pause activity, resolve incidents, enter independent judging results, publish results |
| Captain | Maintain team roster/profile, designate at most one additional trader, trade for the shared wallet |
| Trader | Commit seed investments and buy/sell for the team |
| Member | Browse, inspect the shared portfolio, contribute private investment notes and project updates |
| Spectator | Deferred for v1; event participants can read the market, but unauthenticated browsing is not required |

One person can belong to one competing team in an event. Organizers do not compete or trade. Nobody shares a password or authenticates as a team. A team code requests membership; it does not confer captain/trader privileges. Approved membership and server-side permissions control wallet access.

Captain and designated trader may both act, but wallet versions prevent simultaneous actions from overspending. Membership and trader changes after seed opens require an organizer, with an audit entry. An organizer can suspend a compromised account without rewriting its team's history.

## The useful investment sheet

A private, lightweight thesis attached to a project:

- **Why we backed it** — short free text.
- **What would change our mind** — optional.
- **Next thing to check** — optional.
- Position, cost, and trade history — generated from the ledger.

This lives inside the project/portfolio flow. It is not a spreadsheet builder or a fifth navigation destination. “Download portfolio CSV” gives teams a portable table of holdings, cost, and results. Team members can read and edit shared notes; note authors and timestamps remain visible. Other teams cannot see notes or individual portfolios during the event.

## First release scope

The first release is complete when organizers can run one real event from registration through verified results, and teams can participate comfortably from a phone.

| Include | Later, if demonstrated useful |
|---|---|
| Approved teams, individual sign-in, shared wallet | Individual investor mode or spectators trading |
| Concise project profiles and checkpoint updates | Video uploads, rich pitch decks, public comments |
| Sealed seed commitments and deterministic allocation | Multiple dilutive funding rounds or spendable project treasuries |
| Buy/sell quotes during controlled windows | Order books, limit orders, derivatives, leverage, shorts |
| Portfolio, private thesis notes, receipt history | Custom spreadsheet/report builders |
| Separate backing and investment standings | Social feeds, achievement systems, notifications everywhere |
| Pause, resumable settlement, ledger export | Multi-event organizer billing, integrations, judge portal |

No tokens, wallets on a blockchain, or generative AI are needed for this product. The futuristic quality should come from a responsive, precise experience and an unusual social mechanic.

## Success criteria for the pilot

These are targets to evaluate, not promised measured outcomes.

- At least 80% of teams make an intentional opening investment.
- Median first investment takes less than three minutes after login, excluding time spent comparing projects.
- Most teams back at least three other projects without being forced to spend.
- Participants can explain the difference between seed backing, market price, and final share value.
- Active trading takes roughly 5–10 minutes per team across the event, apart from project discovery and conversation.
- No duplicate accepted trades, negative balances, unexplained shares, or unauthorized wallet access.
- Organizers complete the main phase transition in under a minute and can identify and pause a failed operation.
- Normal pilot usage fits the measured cost envelope in [the platform plan](06-cost-and-platform.md).

Observe five teams before polishing charts. If they cannot predict what will happen when they buy, sell, or reach the final results, revise the rules and wording before adding features.
