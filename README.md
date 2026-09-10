# RobinHacks

A mobile-friendly hackathon market. Every team builds a project, starts with 10,000 fictional credits, and invests in other teams through a shared portfolio. Organizers control funding, trading windows and the judged finish.

The application is implemented with React, TypeScript and Firebase. It includes a local demo, Firebase emulator support, server-authorized commands, resumable funding/results operations and a separate organizer console. **Live app: [robinhacks-2026-ajs.web.app](https://robinhacks-2026-ajs.web.app).** Sign in with the configured organizer Google account for organizer access. The event starts in Registration; approve real teams before opening funding. See the [Firebase setup guide](docs/FIREBASE-SETUP.md) for deployment and maintenance.

## Current design and event readiness

The September 10 interface follows the compact blue navigation, Verdana typography, bordered tables and direct labels in [Builders Club](https://github.com/Emergent-Brown/buildersclubemergent). RobinHacks uses its own pixel robin mark. Shared styles are split into `base.css`, `shell.css`, `components.css` and `pages.css`; feature components retain the same application and gateway boundaries.

Existing-team discovery, late teammate requests and password recovery are implemented. Read the [event-readiness audit](docs/10-product-audit.md) for the remaining priorities: backup organizer controls, verified identity during approval and saved judging drafts.

## Watch and try it

**[Watch the 4:19 walkthrough](https://robinhacks-2026-ajs--walkthrough-pyhnt4be.web.app/walkthrough/)** or **[try the interactive demo](https://robinhacks-2026-ajs--walkthrough-pyhnt4be.web.app/)**. The preview links expire on **October 9, 2026**.

The video was recorded September 9 and shows the earlier interface; the interactive demo has the September 10 redesign. The video has 17 chapters, English captions and a transcript. It follows a fictional event with 12 teams and 48 participants through real local application commands, from seed funding to published results, including captain, teammate, organizer and mobile views. Narration uses a locally generated synthetic voice. The interactive preview starts in the default trading preset; the video uses a separate Foundry seed scenario. All sample credits are fictional, and preview activity stays in your browser.

Video files are generated locally in `output/playwright/walkthrough/` and are not included in the repository. See the [walkthrough guide](docs/WALKTHROUGH.md) for the recorded chapters and exact commands to recreate the fixture, narration, browser capture and video.

## Run it locally

Requires Node.js **22.12 or newer** and npm.

```sh
npm ci
npm run dev
```

Open [localhost:5173](http://localhost:5173). The default mode is a seeded browser demo with 12 projects. No Firebase account or environment file is needed. Use **Demo** to switch between captain, member and organizer, reset trading, or start a fresh funding round. Demo activity stays in that browser’s local storage.

To exercise real Firebase Authentication, Firestore rules and callable Functions locally, install **Java 21 or newer**, then run:

```sh
npm run dev:firebase
```

This builds Functions, starts the emulators, seeds local accounts and opens the Vite development server. The emulator project is always `demo-robinhacks`; the seed command refuses remote emulator hosts. The Firebase Emulator UI is available at [localhost:4000](http://localhost:4000). If port 5173 is already in use, start this mode with `WEB_PORT=5174 npm run dev:firebase`.

All three local test accounts use the password `hackathon-demo-2026`:

| Role        | Email                    |
| ----------- | ------------------------ |
| Captain     | `alex@example.test`      |
| Organizer   | `organizer@example.test` |
| Team member | `sam@example.test`       |

The demo password and role switcher belong only to local demo/emulator modes. Production uses Firebase Authentication and approved event membership.

## What teams can do

- Explore projects, read progress updates, and open a focused investment sheet.
- Reserve up to 5,000 credits in one sealed funding round at 100 credits per share.
- Buy and sell during up to three organizer-controlled trading windows.
- Manage shared holdings, receipts and private investment notes.
- Edit their team profile and see fundraising, project and investment standings separately.

A team can hold at most 25 shares in another project and cannot buy its own shares. Each window permits 15 successful trades per team, with 10 seconds between accepted trades. Funding raised stays in a locked project vault. It never increases the issuer team’s spending power.

Final portfolio values use independent judging results. They are report scores, not new credits deposited into wallets. All credits are fictional and have no cash value.

## Run an event

1. Complete [Firebase setup](docs/FIREBASE-SETUP.md), then sign in with the separate organizer account.
2. In **Admin → Teams & access**, approve verified requests. The first captain approval creates a team, wallet and project exchange; later members join an existing team. Approve at least two active teams before opening funding.
3. Open the seed round. At close, run **Continue settlement** until all team allocations reconcile. Funding remains sealed until the whole operation finishes.
4. Open trading windows around build checkpoints. Close each into build time. Pause blocks financial actions without extending the original deadline.
5. End trading permanently, collect judge scores externally, and enter aggregate scores from 0 to 100. Preview the share values, lock scores, complete the results operation, then publish.
6. Export the event from a paused or closed phase for an auditable copy of its ledger and reports.

Keep an organizer session visible during an open market for its two-minute public-price refresh. The displayed snapshot includes its age; trade review fetches a fresh individual pool. Deadlines and authorization are enforced by the server even if the browser shows old data.

## Code organization

```text
apps/web/                  React features, reusable UI, demo/Firebase gateways
apps/functions/            Authenticated callable endpoints and Firestore adapter
packages/core/             Pure economic rules, pricing, allocation and scoring
packages/application/      GameService, feature services and repository contracts
firebase/                  Firestore rules and index exemptions
scripts/                   Emulator startup, seeding, bootstrap and reconciliation
tests/                     Application integration and Firestore emulator tests
```

Small domain classes own economic invariants. Application services own authorization and transaction boundaries. Repository and gateway interfaces keep infrastructure out of the rules and UI. React components remain ordinary functional components. The local demo and deployed Functions use the same `GameService` and domain calculations.

See [implementation and maintenance](docs/09-implementation.md) for the actual module boundaries, API/read model, operational limits and differences from the original blueprint.

## Repository hygiene

Environment files, local Auth configuration, generated builds, dependencies, emulator data, logs, browser captures and rendered videos are excluded from Git. Tracked `.env` examples and `firebase.auth.example.json` contain placeholders; copy and configure them locally using the [Firebase setup guide](docs/FIREBASE-SETUP.md). Keep Firebase CLI sessions, service-account keys, tokens and production event exports outside the repository.

Firebase project IDs, web app IDs, domains and browser API keys identify the public client; they do not grant administrator access. Administrator credentials must never appear in frontend `VITE_` variables. The documented emulator password belongs only to fictional localhost test accounts and is not a production credential.

## Verify changes

```sh
npm run check
npm run test:emulator
```

With `npm run dev:firebase` running in another terminal, exercise the Auth/Functions transport:

```sh
npm run test:smoke
```

`check` runs TypeScript, unit/application tests, and production web/Functions builds. `test:emulator` separately verifies Firestore client permissions and the real server repository against a local Firestore emulator. It requires Java 21+ and never targets the configured production project.

To validate an organizer export:

```sh
npm run reconcile -- /absolute/path/to/event-export.json
```

The smoke test uses only local `demo-robinhacks`, exercises authentication, a real trade, replay rejection and an organizer export, and leaves one accepted test purchase in the fixture. The export check validates balances, project share supply, total credits and balanced receipt entries. The test suites also cover replay conflicts, concurrent spending, expired deadlines, holding limits, funding recovery, final report immutability and 10/20/30-team market simulations. Automated checks do not establish that a real event is manipulation-proof or fun; rehearse the event flow with the organizers.

## Firebase and operating costs

Production uses Firebase Authentication, **Firestore Standard** and callable Cloud Functions in `us-west1`, with classic Firebase Hosting serving the web client. Functions are configured with zero minimum instances and at most two instances per endpoint. A billing-enabled Firebase plan is needed for Functions deployment; the aim is normal small-event usage within no-cost allowances.

There is no hard $0 guarantee. Cached private snapshots, bounded team counts, public market snapshots, hidden-tab listener cleanup and request burst limits reduce usage. App Check can be enabled after configuring its site key. Per-instance request limits reset on cold starts and are not a billing cap. See [Firebase setup](docs/FIREBASE-SETUP.md), [implementation notes](docs/09-implementation.md), and the original [cost model](docs/06-cost-and-platform.md). The original model is a planning estimate, not a measurement of this build.

## Documentation

Documents 01–08 are the original product and engineering blueprint. [09 · Implementation](docs/09-implementation.md) describes what the code currently implements and takes precedence where implementation details differ.

| Document                                                                 | Contents                                                                |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| [Firebase setup](docs/FIREBASE-SETUP.md)                                 | Cloud configuration, bootstrap, deployment and concrete recovery steps  |
| [Walkthrough](docs/WALKTHROUGH.md)                                       | Completed video, chapters, transcript and reproducible capture commands |
| [01 · Product brief](docs/01-product-brief.md)                           | Product purpose, roles, event rhythm and scope                          |
| [02 · Market rules](docs/02-market-rules.md)                             | Pricing, funding, accounting and final scoring                          |
| [03 · Experience design](docs/03-experience-design.md)                   | Design rationale and mobile interactions                                |
| [04 · Architecture](docs/04-architecture.md)                             | Original architecture and boundaries                                    |
| [05 · Data and command contracts](docs/05-data-and-command-contracts.md) | Original storage/API specification                                      |
| [06 · Cost and platform](docs/06-cost-and-platform.md)                   | Original operating estimate and platform sources                        |
| [07 · Delivery and validation](docs/07-delivery-and-validation.md)       | Original delivery plan and test strategy                                |
| [08 · Event operations](docs/08-event-operations.md)                     | Event policies and organizer procedures                                 |
| [09 · Implementation](docs/09-implementation.md)                         | Current code, commands, decisions and maintenance guidance              |
