# Application architecture

Emergent Hacks is a React/TypeScript client backed by Firebase Authentication, Cloud Functions and Firestore. The browser-local demo calls the same application services as production, through an in-memory repository.

## Boundaries

| Layer | Responsibility |
| --- | --- |
| `apps/web/src/platform/` | Event pages, forms, accessible feedback, and view state. Feature CSS stays alongside each screen. |
| `apps/web/src/adapters/` | Firebase and demo gateways implement the same authentication, snapshot and command interface. |
| `apps/functions/src/` | Verified Google identity, transport validation, request limits, HTTP poster redirects and Firestore integration. |
| `packages/application/src/game-service.ts` | Command validation, permission context, idempotency, transactions and audit records. |
| `packages/application/src/services/` | Focused services for membership, formation, organizer access, funding, profiles, projects, messaging, judging and ballots. |
| `packages/core/src/` | Typed contracts and pure funding, payout, judging and schedule rules. |
| Repository implementations | Transactional persistence. Firestore batches writes after reads; the memory repository provides equivalent behavior for the demo and tests. |

A UI form sends a command with a new command ID. The server validates the authenticated actor, command shape and current event state, then dispatches to the relevant service within a transaction. A retry with the same command ID and payload returns the committed outcome; reusing an ID with another payload fails. Versions prevent an old tab from silently overwriting newer work.

The client never writes directly to Firestore. Rules allow only narrow subscriptions and reads; private records and mutations pass through application services. A hidden button is not an authorization boundary.

## Access lifecycle

1. Google supplies the account identity and verified email. Signup submits only a display name.
2. An organizer approves attendance. The member is approved but has no team.
3. An organizer opens team selection. Unassigned attendees receive only the formation directory: team names, roster names/roles and available roles.
4. Creation or joining atomically assigns the person and their chosen role. Captain and designated-investor slots are exclusive; members are repeatable. Creating a team does not imply captaincy.
5. The participant enters the team workspace. Opening the first funding round locks competing rosters and economic rules.

Organizer emails are explicitly invited by an existing organizer. A matching verified Google sign-in claims the invitation; signup cannot choose organizer permissions. Judges and organizers are separate from competing teams and skip formation. Removing access preserves project and submitted records and protects the acting organizer and the last approved organizer.

## Event data

Most records live under `events/{eventId}`. The event root contains public information, planned timing, the current phase, formation state and locked funding settings. Membership, requests, organizer invitations and team profiles live in separate collections.

Funding records separate mutable private allocations from immutable round entitlements. Project updates are append-only; final submissions are fixed snapshots. Conversations are scoped to their two teams. Judges see assigned projects and their own scores without funding signals. Public results are published only after a reviewed award preview.

Poster counters live separately from event participation records. A numbered HTTP link records a visit before redirecting to the homepage. Organizer-only statistics do not expose participant identities.

## Runtime and maintenance

Firebase Hosting serves the static client. Six callables handle event commands, scoped snapshots, public metadata, conversations, exports and poster statistics; the poster redirect uses an HTTP Function. Functions and Firestore use `us-west1`. Small instance limits, bounded collections, cached snapshots and no minimum instances constrain ordinary event usage.

Keep credentials and operational data outside Git. Bootstrap and maintenance scripts use the existing Firebase CLI identity rather than frontend credentials. A production reset is a separate explicit operation with backup and maintenance controls; routine deployment does not reset data.

Run `npm run check` for type checking, domain/application tests and builds. Run `npm run test:emulator` for Firestore behavior and rule enforcement. Browser rehearsal should cover Google sign-in, approval, formation, each role's scope, concurrent edits, deadlines and publication. See [Firebase setup](FIREBASE-SETUP.md), [joining and approval](14-joining-and-approval.md), and [sealed-round rules](11-sealed-rounds.md).
