# Emergent Hacks

A mobile-friendly hackathon platform for building projects, meeting other teams, and investing through **three sealed funding rounds**. Each team allocates credits privately; rounds close together and award fixed, conditional shares of a separate investor reward pool. Judges evaluate the projects independently.

The repository retains the technical name `robinhacks`. The participant-facing event is **Emergent Hacks**, with **Silicon Valley** as its theme. React and TypeScript provide the interface; Firebase Authentication, Firestore and callable Functions provide the deployed backend. The local demo runs the same application services and economic rules without a cloud account.

**Updated September 24, 2026:** the [live event](https://emergenthacks.com/) uses the sealed-round platform. The [populated demo](https://robinhacks-2026-ajs--walkthrough-pyhnt4be.web.app/) supports captain, teammate, organizer and judge perspectives. The empty production event was upgraded with its existing organizer preserved. See the [deployment record](docs/FIREBASE-SETUP.md#deployment-record) for verification and remaining rehearsal checks.

## Start locally

Requires Node.js **22.12 or newer** and npm:

```sh
npm ci
npm run dev
```

Open [localhost:5173](http://localhost:5173). Demo mode contains 12 fictional projects and uses browser-local storage. It does not create production participants or send email.

The **Demo** controls switch between captain, teammate, organizer and judge. The preset identifiers are retained for compatibility:

| Preset    | Current experience                                                  |
| --------- | ------------------------------------------------------------------- |
| `seed`    | Registration, before any funding opens                              |
| `trading` | Second sealed funding round open, first-round entitlements visible  |
| `judging` | Three completed rounds, final submissions, independent judging open |

These presets exercise the sealed-round application. They do not enable the original buy/sell game.

For real local Firebase Auth, Firestore and Functions, install **Java 21+** and run:

```sh
npm run dev:firebase
```

The local project is `demo-robinhacks`; the seed script refuses remote emulator hosts. The Emulator UI is at [localhost:4000](http://localhost:4000). Use `WEB_PORT=5174 npm run dev:firebase` if only the web port conflicts. The documented localhost test password, `hackathon-demo-2026`, belongs only to fictional emulator accounts, never production identities. See the emulator startup output for available accounts.

## What is included

- A public event homepage with editable event details, logistics, schedule, registration link, organizer information, contact and judging rubric.
- Numbered NFC poster links that count visits in Firestore, redirect to the homepage, and show organizer-only totals under Admin → Posters. See [poster tracking](docs/13-poster-tracking.md).
- Google-based participant requests with organizer assignment to an existing or new team. See [joining and approval](docs/14-joining-and-approval.md).
- Verified email/Google sign-in, organizer approval, team and staff access requests, backup organizer controls and locked team rosters.
- Project profiles with sectors and optional teammate bios, search by project or person, unopened-project discovery, archived checkpoints, and immutable final submissions with demo, repository and full Git commit.
- Private team-to-team messages, shared inboxes, blocking and reports.
- Autosaved team allocations, read-only round history, deadline enforcement, simultaneous closing, per-round entitlements, audit records and exact payout calculations.
- An independent judge portal with assignments, conflicts, saved drafts, submitted score locks and reviewed awards.
- A private community ballot, results publication, and post-event export/reconciliation.
- A short onboarding tour and replayable rules; layouts support desktop and phone screens.

The interface keeps compact blue navigation, Verdana typography, simple tables and direct labels. There are no live share prices, buy/sell controls or liquidation marks in the sealed-round experience. The official Emergent logo and real event facts remain organizer-supplied configuration/assets; unconfirmed dates, venues and prizes should not be invented.

## Default rules

| Setting                 | Default                                                              |
| ----------------------- | -------------------------------------------------------------------- |
| Account                 | One allocation account per approved team                             |
| Funding checkpoints     | Initial pitch → working prototype → final demo                       |
| Budget                  | 100 new credits per team, per round                                  |
| Allocation              | Increments of 10; at most 60 per project; no own-project allocation  |
| Unused credits          | Expire when that round closes                                        |
| Investor reward weights | 40% / 35% / 25% for the three rounds                                 |
| Minimum denominator     | 200 credits per project, per round                                   |
| Actual prize amounts    | Unconfigured: zero until the organizer announces and configures them |
| Results review          | 30 minutes before publication                                        |

A team's entitlement is `round weight × its allocation ÷ max(200, that project's round total)`. Later rounds cannot dilute earlier entitlements. The investor pool is a **maximum possible payout**, separate from builder prizes; unallocated funds follow the published reserve policy. Publishing a result creates a prize record, not a bank transfer.

Read [11 · Sealed rounds](docs/11-sealed-rounds.md) for the complete current rules, privacy model, lifecycle, architecture and meeting requirement mapping.

## Run an event

1. Complete [Firebase setup and migration](docs/FIREBASE-SETUP.md). Rehearse sign-in with the primary organizer, a backup and a judge.
2. Fill **Admin → Settings** with confirmed event details, prize amounts, reserve policy and judging rubric. Approve actual attendees and separate staff accounts in **Admin → Access**.
3. Collect an initial checkpoint from every active team. Open round one; this locks the funding/judging rules and competing rosters.
4. At the deadline, close the round to reveal totals and freeze entitlements. Teams build, publish the next checkpoint and allocate a fresh budget in round two.
5. Open final submissions before round three. Every active project must submit final evidence and its final checkpoint before the last funding window opens.
6. Finish funding, open judging, assign projects, and collect complete independent score sheets. Run the separate community ballot.
7. Close ballots, prepare awards, check the scores and conditional payouts during the review period, then publish. Export the final event record and reconcile it before distributing any prizes.

Pause preserves everyone's remaining time equally. A revealed round cannot reopen; an event-wide technical failure can void the whole completed round without deleting its history. Participant allocations and live ballots are private even from organizers. Complete exports become available only after publication or cancellation.

## Organization and maintenance

```text
apps/web/src/platform/                 Current event features and shared presentation helpers
apps/web/src/adapters/                 Demo and Firebase gateways
apps/functions/src/                   Callable transport, limits and Firestore adapter
packages/core/src/platform.ts          Version-two types and default configuration
packages/core/src/sealed-funding.ts    Pure allocation, entitlement and payout rules
packages/application/src/              GameService, schemas, repositories and fixtures
packages/application/src/services/     Funding, projects, messaging, judging, ballots and permissions
firebase/                             Deny-by-default client rules and indexes
scripts/                              Bootstrap, migration, emulators, smoke and export checks
```

Small domain classes own economic invariants. Application services own permissions and transactions. Repository and gateway interfaces separate infrastructure from rules and UI. React uses functional components; domain and application responsibilities stay outside those components.

Version-one pricing, trading and settlement code remains isolated for historical events and compatibility tests. Version-two events reject those legacy financial commands. New work should target the platform contracts and services rather than add conditions to the old trading screens.

## Verification

```sh
npm run check
npm run test:emulator
```

`check` runs TypeScript, domain/application tests and production builds. The emulator suite checks real Firestore transaction behavior and client privacy. With `npm run dev:firebase` running, reset the disposable local event to Registration before exercising the authenticated transport:

```sh
npm run seed -- --seed
npm run test:smoke
```

Validate a post-event export locally:

```sh
npm run reconcile -- /absolute/path/to/event-export.json
```

Tests and local rehearsal do not establish production Google sign-in, a completed cloud migration, or whether the event is enjoyable. The [readiness audit](docs/10-product-audit.md) records the remaining operational checks without treating implementation as a live pilot.

## Hosting and repository hygiene

Classic Firebase Hosting serves the client. Firebase Auth, Firestore Standard and six callable Functions use the existing `robinhacks-2026-ajs` project, with Functions in `us-west1`. Bounded data and zero minimum instances aim to keep a small event within no-cost allowances. Blaze can still incur charges; budget alerts are not spending caps. See [Firebase setup](docs/FIREBASE-SETUP.md).

Environment files, local Auth configuration, production exports, credentials, dependencies, builds, emulator state, logs and recordings are excluded from Git. Tracked examples contain placeholders. Keep administrator credentials out of frontend `VITE_` variables. Public Firebase project/app identifiers do not grant administrator access.

## Documentation and historical recordings

- [11 · Sealed rounds](docs/11-sealed-rounds.md): authoritative current product and engineering guide.
- [15 · September website feedback](docs/15-september-feedback.md): homepage logistics, registration, project discovery, bios, round history and judging updates; organizer controls and guarded publication steps.
- [10 · Readiness audit](docs/10-product-audit.md): event facts, staffing, deployment and rehearsal still to confirm.
- [Firebase setup](docs/FIREBASE-SETUP.md): infrastructure, safe migration and release steps.
- Documents **01–09**: historical September 8–10 trading proposal and implementation notes, superseded by document 11.
- [Historical walkthrough](docs/WALKTHROUGH.md): the September 9 video demonstrates the retired trading model. Its recording scripts have not been adapted for the sealed-round product; old preview links are not a current product walkthrough.
