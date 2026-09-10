# Event-readiness audit

Reviewed September 10, 2026, for a first event with 10–30 teams and up to 150 participants. This review traced the application and server code, then verified the onboarding changes with integration tests. It did not change production event records or verify interactive live sign-in.

**The core game supports a supervised event. The most important remaining work is operator backup, verified participant identity and a durable judging sheet.** Two onboarding gaps found in the review are now fixed, alongside password recovery. The onboarding server update and redesigned interface were deployed September 10. Rehearse the complete sign-in and approval flow before the event.

## Already implemented

- **Account approval and financial permissions.** Approval creates a new team’s wallet/exchange; requesting membership creates no credits. Captains can designate one trader before funding. Organizers can correct the roster while paused. Private records go through authorized callables, and direct client writes are denied. See [membership service](../packages/application/src/services/membership-service.ts#L68), [roster policy](../packages/application/src/services/permissions.ts#L40), and [Firestore rules](../firebase/firestore.rules#L14).
- **Trading with recovery.** The server checks role, phase, deadline, wallet/pool versions, reviewed price, cash and holding limits. An uncertain trade keeps its original request ID so retrying retrieves the receipt without executing twice. See [trade service](../packages/application/src/services/market-service.ts#L20) and [pending request recovery](../apps/web/src/features/Trading.tsx#L141).
- **Running and finishing an event.** Manual windows, announcements, pause/resume, eligibility changes, resumable funding/results, independent aggregate judging, explicit publication and audited exports exist. Settlement uses persistent team units and reconciliation. See [organizer controls](../apps/web/src/features/Admin.tsx#L176), [settlement continuation](../packages/application/src/services/operation-service.ts#L197), [publication](../packages/application/src/services/operation-service.ts#L330), and [export](../packages/application/src/game-service.ts#L312).

## Fixed during this review

**Existing-team discovery:** new participants previously received an empty market, leaving their team selector unreachable. Their snapshot now includes a bounded `joinableTeams` directory containing only active team IDs and names. Wallets, holdings, notes, receipts, other memberships and results remain private. See [game-service.ts:237](../packages/application/src/game-service.ts#L237) and [AppSnapshot](../packages/core/src/types.ts#L183).

**Late teammates:** previously every access request was rejected once funding opened, even for an existing team. Requests to an existing active team now work during seed funding, build time, trading and frozen judging. Settlement and terminal phases reject them. A late request remains pending until an organizer pauses the event and approves it. New competing teams remain restricted to Registration, and no wallet or allocation changes when a teammate joins. See [membership-service.ts:10](../packages/application/src/services/membership-service.ts#L10).

**Password recovery:** the sign-in flow now offers a Firebase password-reset email with a neutral response that does not disclose whether an account exists. See [FirebaseGateway.ts](../apps/web/src/adapters/FirebaseGateway.ts#L196) and [AccessScreen](../apps/web/src/features/Team.tsx#L380). Email verification remains separate work.

## Three practical priorities

### 1. Add a backup organizer before the event

Bootstrap provisions one specific organizer ([bootstrap-firebase.mjs:19](../scripts/bootstrap-firebase.mjs#L19)). Admin exposes captain/trader/member assignment and displays organizers as a static role, with no action to add another organizer ([Admin.tsx:362](../apps/web/src/features/Admin.tsx#L362)). A lost session or unavailable operator can therefore interrupt event control.

The backend already permits promoting a separate, team-less account and protects the last approved organizer ([membership-service.ts:250](../packages/application/src/services/membership-service.ts#L250)). An in-memory check confirmed promotion works, but leaves that person’s original request pending.

**Current workaround:** developer-assisted use of the existing command after verifying the backup’s identity. The [operating blueprint](08-event-operations.md#organizer-responsibilities) already calls for a backup.

**Smallest useful change:** expose a reviewed “Add organizer” action for a verified, team-less account, resolve its pending request and retain the audit event. Rehearse resuming an interrupted settlement with the backup account. Captain handoff already works by demoting the old captain and promoting the new one while paused; an atomic handoff is a later convenience.

### 2. Verify email identity before approving access

Email signup does not send verification, and the callable checks authentication without requiring a verified email ([FirebaseGateway.ts:187](../apps/web/src/adapters/FirebaseGateway.ts#L187), [functions/index.ts:42](../apps/functions/src/index.ts#L42)). The approval card shows a submitted name and team name, without a verified account email ([Admin.tsx:744](../apps/web/src/features/Admin.tsx#L744)). Manual approval protects access, but identifying the right person is unnecessarily difficult.

**Current workaround:** use Google sign-in and verify attendees in person.

**Smallest useful change:** add verification/resend for email accounts, require verification before requesting membership, and show the verified email only to organizers. A Google-only first event is also a reasonable smaller product decision. Shareable team join links would reduce queue management, but the new team selector makes them optional for this pilot.

### 3. Preserve and review the judging sheet

Scores currently live only in component state and can be lost on reload/navigation ([Admin.tsx:50](../apps/web/src/features/Admin.tsx#L50)). Final review shows rank, project and share value, but omits the entered judge score ([Admin.tsx:602](../apps/web/src/features/Admin.tsx#L602)). Locking creates an immutable manifest and starts finalization, with no supported score-correction command afterward ([operation-service.ts:163](../packages/application/src/services/operation-service.ts#L163)).

**Current workaround:** keep authoritative scores in an external sheet and have a second person check the entries before locking. “Edit scores” works before the lock.

**Smallest useful change:** save an organizer-only draft and show original score, rank and share value together in the final review. A spreadsheet import can avoid retyping 30 rows. If post-lock corrections become a requirement, use a versioned replacement report that preserves the original manifest and never rewrites trades.

## Useful improvements that can wait

A small event-settings form for name, venue, help contact and a visible agenda would reduce developer involvement. Today the event ID is selected at build time ([FirebaseGateway.ts:60](../apps/web/src/adapters/FirebaseGateway.ts#L60)), and bootstrap supplies its initial name/venue ([bootstrap-firebase.mjs:343](../scripts/bootstrap-firebase.mjs#L343)). Multi-event selection is a later capability, not a prerequisite for this configured event.

Automatic phase opening, a native judge portal, price-history charts and extra funding rounds can wait. Existing server deadlines reject late financial actions ([event-policy.ts:39](../packages/core/src/event-policy.ts#L39)); the organizer advances phases manually. Keep an organizer tab visible for public-price refresh and export at checkpoints. App Check remains a deployment hardening step documented in [Firebase setup](FIREBASE-SETUP.md#cost-controls-and-app-check).

## Validation boundary

All 77 application/domain tests and 84 Firestore security/transaction tests pass. The 22 new [onboarding integration cases](../tests/membership-onboarding.test.ts) and 20 existing GameService cases pass together. They verify directory privacy/bounds, pending access, late requests, paused approval, unchanged finances, inactive teams, closed phases, new-team restrictions and the participant cap. TypeScript also passes. No production records were changed.

The setup guide still records interactive hosted Google sign-in as an outstanding check ([deployment record](FIREBASE-SETUP.md#deployment-record)). Verify that flow with the primary and backup organizer before the live event; this code audit does not establish production browser authentication.
