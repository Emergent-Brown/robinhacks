# Sealed funding rounds: current product and architecture

**Version 2 · September 14, 2026.** This document supersedes the September 8–10 trading proposal and implementation notes in documents 01–09. It describes the current source implementation. Deployment and production migration are tracked separately in [Firebase setup](FIREBASE-SETUP.md#deployment-record).

## Product

The participant-facing event is **Emergent Hacks**. Silicon Valley is the theme; `robinhacks` remains the repository, package and Firebase identifier. A public homepage explains the event and links into the account flow. Date, venue, schedule, registration link, contact and eligibility are editable facts, not generated marketing copy.

Teams build projects, share checkpoint evidence, investigate other teams and allocate credits during three sealed funding windows. They enter an amount, not a share order. A completed investment remains attached to its original round. There is no resale or continuously changing price. The [September 26–27 schedule](12-september-schedule.md) supplies the current editable window defaults.

The platform rewards discovery without requiring continuous trading. It cannot prevent all social coordination; verified attendance, independent judging and published conduct rules remain necessary.

## Default rules and configuration

| Rule | Default |
| --- | --- |
| Event size | 2–30 active teams; up to 150 approved competing participants |
| Account | One shared allocation account per team |
| Authorized writer | Captain or one designated trader/investor |
| Rounds | Initial pitch, working prototype, final demo |
| Budget | 100 new virtual credits in each round |
| Increment | 10 credits |
| Per-project maximum | 60 credits per team per round |
| Own project | Cannot receive the team's own allocation |
| Unused credits | Expire at that round's close |
| Later funding received | Does not give the receiving team more allocation credits |
| Round reward weights | 40%, 35%, 25% |
| Minimum denominator | 200 credits per project per round |
| Prize defaults | Zero until actual amounts are configured and announced |
| Results review | 30 minutes |

Funding settings, all prize amounts, reserve policy, review duration and the judging rubric lock when the first round opens. Project and member identifiers remain stable. Public logistical details can still be corrected separately. The rule validator requires exactly three named positive-weight rounds totaling 100%; a divisible budget/increment; a project cap below the budget; and a minimum denominator at least as large as one team budget.

The concentration limit means a team spending all 100 credits must back at least two projects. Spending every credit is optional. With only two active teams, a team can allocate at most 60 to the sole other project and lets the rest expire. The cap is an event-design choice, not a claim that allocations express mathematically truthful probabilities.

## Sealed allocation and fixed entitlements

Teams edit a shared allocation sheet. Valid sheets autosave; the interface distinguishes saving, saved, failed and conflicting changes. Every save includes an expected version. If another teammate or tab saves first, the old version is rejected rather than silently overwriting their work.

Only that team's approved members can see its pending allocation. Other teams, judges and organizers receive no current-round totals, investor counts or ownership estimates derived from pending entries. There is no reward for submitting first.

The server rejects saves at or after the closing timestamp. At the deadline, an organizer closes the round in a single bounded transaction. Closing freezes the sheets, publishes project totals and creates each team's awarded entitlement. Missing sheets are treated as zero allocation. Closing cannot happen early, and a completed round cannot reopen.

For investor team `i`, project `j` and round `r`:

```text
awarded fraction(i, j, r)
  = round weight(r) × allocation(i, j, r)
    / max(minimum denominator, project total(j, r))
```

Round weight is stored as integer basis points. The stored entitlement retains the allocation, project total, denominator and weight; it does not store a rounded percentage as the authoritative claim.

Example: a 60-credit allocation into a project receiving 400 credits during the 40% round earns `0.40 × 60 / 400 = 6%` of that project's conditional investor pool. Later rounds cannot reduce that 6%. If the project receives only a single 10-credit allocation, its entitlement is `0.40 × 10 / 200 = 2%`, not the entire round pool.

The denominator is a floor for allocation math, not a target a project must meet. An unfunded project remains eligible to win the judges' prize. Larger early-round pools reward early participation, but a crowded early round can still yield less entitlement per credit than a less crowded later round.

## Prize accounting

Builder prizes, the investor reserve and the community prize are separate. Founders keep the announced builder prize; they do not surrender real equity or half their prize to investors. The configured investor pool applies to the **judges' grand-prize winner only**. Runner-up builder awards and the community award do not trigger investor payouts.

For a winning project, sum each investor's exact fractions across all non-void rounds, multiply once by the investor pool in minor currency units, then round down once to a whole minor unit. Rational `BigInt` arithmetic owns that calculation. Floating-point percentages are display values only.

The sum paid cannot exceed the configured reserve. Unallocated fractions and rounding remainders stay in the organizer reserve according to the published policy. The default policy retains them for a future event. They are not redistributed to founders or other investors. Disqualified investor teams are excluded from payout; a withdrawn project cannot win, and its ordinary project failure does not refund the people who backed it.

All production prize amounts default to zero. A displayed entitlement is conditional, not a cash promise. Configuring and publishing prize amounts requires actual organizer decisions. The application calculates and exports prize records; it has no payment processor and makes no bank transfers.

## Event lifecycle

| Stage | Organizer action | Participant behavior |
| --- | --- | --- |
| Registration | Confirm settings; verify attendees; approve teams, backup organizers and independent judges. | Join a team; review onboarding; complete a profile and initial checkpoint. |
| Initial pitch round | Open round one; rules and rosters lock. Close at its deadline. | Allocate a fresh budget privately; completed entitlements become visible afterward. |
| Build checkpoint | Keep funding closed; publish announcements and schedule discovery. | Build, visit demos, message teams and archive a prototype update. |
| Prototype round | Open and close round two. | Make a new allocation; prior investments remain unchanged. |
| Final evidence | Open a submission window before round three. | Submit the profile, demo and full code commit; publish the final checkpoint. |
| Final demo round | Open only when every active team has a final submission and checkpoint. | Make the last sealed allocation. |
| Judging | Finish all three rounds, begin judging, assign submitted projects and open the separate community ballot. | Judges score independently; teams rank other projects in a private ballot. |
| Results review | Close ballots and prepare an award preview after all required sheets are submitted. | No further funding or evidence changes. |
| Publication | Wait the configured review period, verify the result and explicitly publish. | View builder, investor and community results. |
| Reconciliation | Export the final record and reconcile it before distributing prizes. | Prize fulfillment is handled outside the application. |

Storage phase names are retained for compatibility: `REGISTRATION` before funding, `SEED_OPEN` for any live sealed round, `INTERMISSION` between rounds, `FROZEN` for judging, `FINALIZING` for award review, and `FINALIZED` for published results. `CANCELLED` and `ARCHIVED` are terminal historical states. The current interface uses participant-facing labels rather than presenting legacy phase terminology as a trading product.

Funding windows can be configured from one minute to 24 hours. Deadlines depend on the server clock, not the participant's device clock. Opening is manual; the app does not create background schedules or send unsolicited emails.

### Pauses, failures and cancellation

A pause blocks allocations and other paused event changes. Resuming extends deadlines that still had time remaining when the pause began by the same elapsed pause duration for everyone. A deadline already elapsed before the pause is not revived. Saved allocations stay intact. Ordinary conversations remain available during building and paused periods.

After totals are revealed, submissions cannot reopen. For a serious event-wide incident, an organizer can void an entire completed round with an attributable reason. Entitlements are marked void, their original data stays recorded, and that round's reserve remains unallocated. A void is not an extra round or an opportunity to replay a revealed result.

Canceling stops participation without publishing prize results; history remains available for audit. Unpublished investor rewards are not paid. Do not settle at a fabricated last price or erase financial history to restart an event.

## Profiles, evidence and final submission

A project page contains its name, concise pitch, problem, implementation, demo/repository links and public roster names. There is no free-text category. Captains/designated investors edit profiles between funding windows. Profiles remain fixed during an open funding window and after final submission.

Checkpoint updates are separate append-only records:

- What works now.
- What changed; optional for the initial pitch, required for later checkpoints.
- A public evidence link when available.
- What remains incomplete or risky.

Updates are tagged with the target round, server timestamp and author. They must be published before that round opens. Every active team needs the matching checkpoint to open a round. Fields are short, bounded to 600 characters; a team can archive up to ten updates, with a 300-update event bound.

Final submission is an explicit action, distinct from saving a profile. It captures the profile, demo/repository links, technology note, full 40- or 64-character Git commit identifier, submitted roster, submitter and server timestamp. A mutable repository URL alone is insufficient. Captains/designated investors submit during the organizer's deadline window, before the final funding round. The stored snapshot is immutable even if the remote repository later changes; the app does not fetch repositories or videos inside its database transactions. It records submitted references rather than guaranteeing a remote artifact's permanent availability.

Inactive projects are excluded from new funding rounds. A withdrawn/disqualified project cannot return after the roster lock. Non-submitting active projects must be resolved before the last round can open; they cannot silently proceed to judging as valid submissions.

## Discovery, onboarding and messages

The signed-out homepage explains the event, shows confirmed logistics and links to access. New team participants receive a short onboarding tour; the rules can be reopened. Project discovery suggests a small rotating group of unfamiliar projects instead of emphasizing a richest-portfolio leaderboard.

Messages belong to a pair of teams, with teammate names attached to individual sends. All approved competing teammates can participate. Judges and organizers do not enter competing team conversations. Each team has a private inbox with previews, shared read status and blocking controls.

A conversation holds at most 250 messages, each at most 1,000 characters. A team can send one message every five seconds across all its conversations. Either team can block the conversation; a sender cannot undo the recipient's block. A report exposes the selected message and reason to organizers. It does not give them routine access to the full conversation. Up to 100 reports can be filed through the app; the event's contact is the fallback reporting route.

Discussions and private diligence are allowed throughout the event. Public official progress updates provide shared evidence. The conduct policy prohibits deceptive claims, sabotage, quid-pro-quo backing and deliberate outcome manipulation. Private allocations reduce some gaming opportunities; they do not make social coordination impossible.

## Independent judging

Judges request a separate staff identity and require organizer approval. A judge cannot also be a competing team member. Assignment records contain the projects to review and declared conflicts. Judges receive assigned immutable submissions, public progress, relevant public roster names and their own sheet. Before publication, they receive no funding totals, other judges' drafts, private ballots, investor entitlements or award previews.

The default rubric uses whole-number criterion scores from 0 to 10:

| Criterion | Weight |
| --- | --- |
| Functionality | 35% |
| Usefulness | 30% |
| Originality | 20% |
| Technical execution | 15% |

The rubric is editable before the first funding round and then locks. Up to 50 judge assignment records are supported, each covering at most 30 projects. Notes are limited to 1,500 characters per project. Drafts may be incomplete and are persisted with optimistic versions. Final submission requires every assigned eligible project to be fully scored or marked conflicted with a reason. Submitted sheets and their assignments lock; an organizer cannot quietly rewrite a submitted score.

Every active, finally submitted project must have at least one non-conflicted submitted judge score. All judges assigned eligible non-conflicted projects must submit before award preparation. Each project's result averages its weighted judge scores. Funding is not part of that formula.

If highest scores tie exactly, preparation requires an explicit winner among those tied projects and a recorded explanation of the announced judging tiebreaker. Other exact-score ties use stable project-ID order. The organizer must approve and explain this rule before prize amounts are locked.

Award preparation freezes scores, rank, builder prize, investor totals, community result and the configured settings into a private preview. Its review period defaults to 30 minutes. An unpublished preview can be discarded with a reason; the archived preview remains. Published awards cannot be discarded or silently edited.

## Community ballot

After funding, the organizer can open a separate private ballot. The captain/designated investor saves one shared ballot per team; teammates can read it. A ballot ranks `min(3, eligible other projects)` distinct submitted active projects. Self-votes and duplicates are rejected. A two-team event therefore accepts one ranked choice from each team.

Ranked choices earn 3, 2 and 1 points. Ties break by first-choice count and then stable project-ID order. No votes means no community winner. The award goes to builders and has no effect on investment entitlements or judge scores. Live ballots stay private even from organizers; they are tallied for the final award review.

## Privacy and authorization

| Viewer | Available data |
| --- | --- |
| Signed-out visitor | Public event facts and rules; no private team, allocation, message or judging records |
| Pending participant | Their access status and bounded existing-team names/IDs |
| Approved teammate | Project evidence and public roster names; their shared allocations, entitlements, ballot and conversations |
| Judge | Assigned submissions, public progress, relevant roster names, own assignments and own sheet; no funding signal before results |
| Organizer | Verified access requests, staff/roster controls, judge assignments/sheets, selected message reports, event controls and private award preview; no live allocations/ballots or ordinary DM access |
| After publication | Published award results; organizers can export the full auditable funding/judging record |

Email/password accounts must verify their email before requesting access. The account screen explicitly sends/resends verification email and refreshes identity after the person follows the link. Google sign-in can supply verified email identity. Email verification is not attendance verification: organizers still check the actual person and team.

The first funding round locks competing team membership and roles. Team-less staff identities can be approved separately; the last approved organizer is protected against removal. Account suspension remains an enforcement action, not a mechanism to create a new team budget.

Firestore client rules deny all writes. Limited direct reads support the current member's status, public metadata for approved members, non-judge project views and a competing team's own inbox. Private allocation, conversation, submission and judging reads go through the application services. Complete exports are permitted only after publication or cancellation, excluding ordinary conversations; pausing an active event is not a way to inspect sealed allocations.

## Architecture and data model

The local demo and Firebase Functions call the same `GameService`. Its transaction boundary validates the command, verifies membership, handles idempotent command IDs, dispatches to the relevant service and records an attributable audit/receipt. A retry with the same payload cannot execute a committed operation twice; reusing the ID for another payload fails.

| Module | Responsibility |
| --- | --- |
| `packages/core/src/platform.ts` | Version-two contracts and safe unconfigured defaults |
| `packages/core/src/sealed-funding.ts` | Allocation validation, bounded round close, exact entitlements and payout arithmetic |
| `packages/application/src/platform-schema.ts` | Strict command shapes, bounded strings/maps and identifiers |
| `FundingService` | Rules configuration, private sheets, funding deadlines, close and whole-round void |
| `CommunityService` | Evidence/social/judging command facade and role-scoped snapshot composition |
| `ProjectService` | Append-only checkpoints and immutable final submissions |
| `MessagingService` | Conversation authorization, team rate limit, private inboxes, blocks and reports |
| `JudgingService` | Assignments, conflicts, drafts, score locks, award preparation/review/publication |
| `BallotService` | Private team ballot versions and deadlines |
| `MembershipService` / permission classes | Verified access, roles, roster lock and profile permissions |
| `MemoryRepository` / `FirestoreRepository` | Serializable demo transactions / buffered native Firestore transactions |
| `apps/web/src/platform/` | Focused React feature screens and shared rendering helpers |
| Demo/Firebase gateways | Authentication, scoped snapshots, commands and inbox refresh behavior |

The public Firebase endpoints are `gamePublic`, `gameSnapshot`, `gameCommand`, `gameConversation`, `gameExport`, and retained legacy `gamePool`. Version-two events reject legacy financial commands and pool requests. `gamePublic` returns event metadata without requiring sign-in; it does not expose sealed data.

All event data lives under `events/{eventId}`:

| Collection/document | Contents |
| --- | --- |
| Event root | Metadata, current phase, server deadlines, version-two settings and first-round rule lock |
| `members`, `accessRequests`, `teams` | Verified identities/roles, approval queue and project profiles |
| `fundingRounds` | One record per round; frozen eligible team IDs, deadline, weight, denominator and revealed totals |
| `roundAllocations` | Latest version of one team's sealed amount sheet per round |
| `roundEntitlements` | Immutable per-team round allocation facts; void status is recorded explicitly |
| `projectUpdates` | Append-only checkpoint evidence and author timestamps |
| `submissions` | One immutable final snapshot per project |
| `conversations`, `teamInboxes` | Private bounded messages, blocks, shared read state and own-team summaries |
| `messageReports` | The reported message and reason for organizer review |
| `judgeAssignments`, `judgingSheets` | Separate judge scopes, conflicts, persisted drafts and submission locks |
| `communityBallots` | Private versioned team rankings |
| `awardResults` | Archived preparation snapshots plus current reviewed/published result |
| `adminAudit`, command/receipt records | Attributable operations, retries and export history |

Round close writes at most one entitlement per team plus the event/round records, safely below the repository's 450-write transaction ceiling. Database adapters stage writes until reads finish. There is no remote repository fetch, email send or payment operation inside a database transaction.

## Requirements traceability

This matrix summarizes the implemented decisions without reproducing the meeting transcript.

| Requirement | Implementation |
| --- | --- |
| Unified event name and uncluttered identity | Emergent Hacks name; Silicon Valley theme; restrained shared navigation and typography |
| Public shareable homepage | Public event metadata endpoint, confirmed logistical fields, schedule, registration and contact |
| Direct team communication | Private conversations, shared inboxes, blocks and selected-message reports |
| Formal project submissions | Explicit immutable submission with existing profile, demo, repository, full commit and roster |
| Native judging | Independent staff role, assignments/conflicts, saved drafts, locked sheets and reviewed results |
| Remove undefined categories | Category removed from current forms and discovery UI |
| Public member names | Public roster projection separate from private verified email identities |
| Sequential project progress | Append-only, timestamped, round-tagged update history |
| First-use explanation | Onboarding tour and replayable concise rules |
| Amount-based private rounds | Shared autosaved amount sheets; server lock and simultaneous close |
| No dilution between rounds | Separate 40/35/25 default entitlements stored from each closing snapshot |
| Prevent token capture of an empty pool | Published minimum funding denominator, default 200 credits |
| Separate builder and investor incentives | Independent judging, fixed announced builder prizes and separate conditional investor reserve |
| Community recognition | Private ranked team ballot, separate from investment and judge results |
| Discovery beyond the most visible teams | Rotating small groups of unfamiliar projects |
| Fair failures and complete audit | Shared pause extension, no reopening revealed rounds, explicit whole-round void, reviewed publication and export reconciliation |
| Maintainable implementation | Pure economic domain, focused application services, strict contracts, repository/gateway boundaries and modular React features |

## Validation and release boundary

Domain/application tests cover allocation validation, close-order independence, expiring budgets, fixed entitlements, exact bounded payouts, private snapshots, concurrent versions, immutable evidence, messaging authorization, judge independence, ballot rules and result review. Firestore tests exercise real repository transactions and client read/write boundaries; smoke checks exercise callable transport with local Auth.

Use `npm run check`, `npm run test:emulator`, and `npm run reconcile -- /absolute/path/to/export.json`. With local emulators running, `npm run seed -- --seed` resets the disposable fixture to Registration before `npm run test:smoke`. The current deployment result and any unverified hosted browser behavior belong in the [deployment record](FIREBASE-SETUP.md#deployment-record), not assumptions in this specification.

Real event facts, the official logo, prize amounts, assigned staff and the hosted pilot remain organizer decisions/checks listed in [the readiness audit](10-product-audit.md). The earlier video demonstrates version one and is not a walkthrough of these rules.
