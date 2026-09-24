# Firebase setup and deployment

This repository uses the existing `robinhacks-2026-ajs` Firebase project. Its participant-facing name is **Emergent Hacks**. Renaming the product does not rename the project, event ID or Hosting domains.

The source implements sealed funding rounds with Google-only signup, independent approval and organizer-controlled team selection. The deployment record below distinguishes published releases from current source changes.

## Configured resources

| Resource | Value |
| --- | --- |
| Project | `robinhacks-2026-ajs` |
| Firebase console | [Open project](https://console.firebase.google.com/project/robinhacks-2026-ajs/overview) |
| Primary URL | [Emergent Hacks](https://emergenthacks.com/) |
| Firebase Hosting URL | [Firebase domain](https://robinhacks-2026-ajs.web.app/) |
| Event ID | `robinhacks-2026` |
| Database | `(default)`, Firestore Standard, `us-west1` |
| Web app | App ID `1:594324444355:web:beae64a96445b8e3707e76` |
| Sign-in | Google only |
| Initial organizer | Configured verified Google identity, separate from competing teams |
| Billing | Blaze, linked to an owner-managed billing account |
| Current server source | Six second-generation callables in `us-west1`: `gameCommand`, `gameSnapshot`, `gamePublic`, `gameConversation`, `gameExport`, `posterStats`; HTTP redirect `posterVisit` |

Sample teams belong to local browser/emulator fixtures, not production. Current source does not establish which release is deployed; verify the live client and Functions after publication.

## Local configuration

The ignored `apps/web/.env.production` holds the browser SDK configuration on the original workstation. Firebase web project identifiers and API keys identify the client; they are not administrator credentials. Never put privileged credentials in `VITE_` variables or commit a service-account key.

On another workstation:

```sh
npm ci
npx -y firebase-tools@latest login
npx -y firebase-tools@latest use robinhacks-2026-ajs
npx -y firebase-tools@latest apps:sdkconfig WEB 1:594324444355:web:beae64a96445b8e3707e76 --project robinhacks-2026-ajs
```

Create `apps/web/.env.production` from the returned SDK fields:

```dotenv
VITE_APP_MODE=firebase
VITE_EVENT_ID=robinhacks-2026
VITE_FIREBASE_REGION=us-west1
VITE_FIREBASE_PROJECT_ID=robinhacks-2026-ajs
VITE_FIREBASE_AUTH_DOMAIN=robinhacks-2026-ajs.firebaseapp.com
VITE_FIREBASE_APP_ID=1:594324444355:web:beae64a96445b8e3707e76
VITE_FIREBASE_API_KEY=copy-the-apiKey-returned-by-the-command
```

The default `npm run dev` is a browser-local demo. Production builds read `.env.production`; shell variables override the file, so do not leave `VITE_APP_MODE=demo` set when building a production release.

Copy the operations example only if the local file does not already exist, then set `ROBINHACKS_ORGANIZER_EMAIL` to the approved organizer Google identity:

```sh
cp .env.operations.example .env.operations
```

That ignored file is operational configuration, not a place for tokens or passwords. Bootstrap and maintenance scripts verify the identity against the existing Firebase CLI login. Keep the populated original workstation file instead of replacing it with placeholders.

## Initial bootstrap

The original event and organizer already exist. For an absent event only, bootstrap defaults to read-only preflight:

```sh
node --env-file=.env.operations scripts/bootstrap-firebase.mjs --project robinhacks-2026-ajs
```

After reviewing an empty-project preflight:

```sh
node --env-file=.env.operations scripts/bootstrap-firebase.mjs --project robinhacks-2026-ajs --apply
```

Fresh bootstrap links the exact verified Google identity and creates a version-two sealed-round Registration event with the September 26–27 schedule at the Nelson Center for Entrepreneurship, zero prize amounts and separate organizer membership. It loads the same default configuration as the application. An existing event is inspected rather than reset by bootstrap. It uses the CLI session rather than creating a service-account key or exposing a public bootstrap endpoint. The adapter uses Firebase CLI internals; rerun preflight after a CLI upgrade. `FIREBASE_TOOLS_DIR` can select a compatible installed package if automatic discovery selects an older cached copy.

## Deploy the release

```sh
npm run check
npm run test:emulator
npm run deploy
```

`deploy` builds the client and Functions, then deploys classic Hosting, Firestore rules/indexes and the current Functions in the selected project. `gamePublic` serves limited signed-out event information, and `gameConversation` authorizes a specific team conversation.

Auth configuration is separate from routine deployment, in ignored `firebase.auth.local.json`. To configure Auth on a new workstation, copy the example, replace the Google support email with the approved support address, and review the authorized domains:

```sh
cp firebase.auth.example.json firebase.auth.local.json
npx -y firebase-tools@latest deploy --config firebase.auth.local.json --only auth --project robinhacks-2026-ajs
```

Do not overwrite an existing populated local Auth file. The root lockfile pins the workspace install. `apps/functions/package-lock.json` separately pins the Cloud Build server install; regenerate it with `npm install --package-lock-only --workspaces=false` from that directory when server dependencies change.

After deployment, verify the six callables, the poster redirect, public homepage, event configuration and current UI. Before real teams register, run the read-only initial-state verifier:

```sh
node --env-file=.env.operations scripts/verify-firebase.mjs
```

It checks version-two Registration, the existing organizer, an empty project roster, unauthenticated command denial and the limited public metadata endpoint. After registration starts, its intentionally strict empty-event assertions no longer apply. A successful Hosting upload alone does not confirm backend rules or event configuration.

## Sign-in, approval and team selection

1. Sign in with the organizer Google account. Confirm **Admin → Access** is available.
2. A participant signs in with Google, confirms their name and verified email, and submits a request.
3. Approve the attendee in Admin → Access. They remain unassigned and cannot enter the workspace yet.
4. Select **Start team selection**. The attendee creates or joins a team and chooses Captain, Designated investor or Member. Staff accounts skip this step.
5. Add backup organizers through **Organizer emails**. Their matching verified Google account receives organizer access on sign-in or refresh. Assign judges from approved unassigned accounts.
6. Confirm every participating team has a captain and required checkpoint before opening funding. The first round locks competing memberships and rules.

Access removal requires a concrete confirmation and preserves project and submitted records. After registration, pause the event first. Self-removal and removal of the last organizer are blocked. See [joining and approval](14-joining-and-approval.md) for the complete workflow.

## Local transport and export verification

Run the current version-two emulator fixture:

```sh
npm run dev:firebase
```

In another terminal, reset the disposable local event to Registration, which is the smoke runner’s required starting state:

```sh
npm run seed -- --registration
npm run test:smoke
```

The smoke runner targets localhost `demo-robinhacks` and verifies authenticated transport with mock Google identities.

After final publication or cancellation, an organizer can export the complete event record. Live allocations and ballots cannot be exposed by exporting a paused event. Ordinary private conversations are excluded from the event export. Store exports outside the repository because they include participant identity and private historical allocation/judging data.

```sh
npm run reconcile -- /absolute/path/to/event-export.json
```

Reconciliation independently checks round allocations, totals, exact entitlement facts, award payouts and unallocated reserve. Check the reconciler's result before handling prize distribution. This application records amounts but does not send cash or initiate payments.

## If a step fails

| Error or symptom | Action |
| --- | --- |
| Project must use Blaze | Verify the owner-selected billing account in [Usage and billing](https://console.firebase.google.com/project/robinhacks-2026-ajs/usage/details), then rerun deployment. |
| CLI login expired or identity mismatch | Run `npx -y firebase-tools@latest login --reauth`, select the Google identity configured in `.env.operations`, and rerun read-only preflight. |
| Public homepage callable not found | Deploy the current Functions including `gamePublic`; confirm the client project/region and deployed release. |
| Google sign-in unauthorized domain | Add the actual domain in [Authentication settings](https://console.firebase.google.com/project/robinhacks-2026-ajs/authentication/settings). |
| Google popup blocked | Allow the popup and retry in a normal browser tab. |
| Funding will not open | Check active-team count, approved captains and required checkpoint updates; round three also requires every active final submission. |
| Closing rejects before deadline | Wait until the server deadline. Pause/resume preserves equal remaining time; closing is not an early-cutoff control. |
| Awards cannot prepare | Close all funding/ballots, cover every eligible final submission with a non-conflicted judge, and submit all required sheets. Resolve a top-score tie explicitly. |
| Publication is still disabled | Wait the configured results-review period and resolve any changed eligibility before preparing/publishing again. |
| Emulator Java or port issue | Use Java 21+; stop only an identified disposable local process or choose separate emulator ports. A web-only conflict can use `WEB_PORT=5174`. |

## Cost controls and App Check

The six callable definitions use zero minimum instances, at most two instances, 256 MiB memory and a 60-second timeout. The existing project has a one-day Artifact Registry cleanup policy for generated deployment images. Team/record limits, bounded conversations, cached scoped snapshots and hidden-tab listener cleanup constrain ordinary pilot usage.

Blaze remains capable of charging for usage outside free allowances. Configure a project-scoped budget and alerts in [Cloud Billing](https://console.cloud.google.com/billing/budgets?project=robinhacks-2026-ajs) and inspect actual rehearsal usage. Alerts and per-instance request limits are not hard spending caps. Use measured rehearsal traffic to estimate event usage.

Client writes are denied; authenticated commands enforce identity, roles, deadlines and versions. App Check is optional until configured and tested. Register a reCAPTCHA Enterprise site key in [Firebase App Check](https://console.firebase.google.com/project/robinhacks-2026-ajs/appcheck), set `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`, rebuild and verify normal clients. Then set `ENFORCE_APP_CHECK=true` in the ignored Functions environment and redeploy if enforcing protected endpoints. `gamePublic` deliberately remains an anonymous, bounded metadata endpoint with its own request limit.

For a custom domain, update Authentication's authorized domains and the Functions `ALLOWED_ORIGINS` list. Default CORS permits emergenthacks.com, www.emergenthacks.com, Firebase Hosting domains and localhost. An explicit ALLOWED_ORIGINS value replaces that list, so include the custom domains in any override. Keep all environment files and any App Check debug tokens out of Git.

## Deployment record

**September 24, 2026 — homepage follow-up:** Moved “Who are we?” into About the event, removed the homepage section menu, and replaced the inline rubric with a link in Finish and submit that opens the shared rubric in a dialog. TypeScript and production/demo builds passed. Desktop and 390-pixel browser checks confirmed the modal layout, Escape dismissal and return of keyboard focus to the trigger. Hosting was updated for production and the existing demo; no backend or event data changed. Organizer sign-in instructions now distinguish Google Form registration from app access and include the direct admin route.

**September 24, 2026 — website feedback and attendee information:** Hosting and all eight existing Functions were deployed. The homepage now links to the registration form and Emergent, exposes logistics and the live rubric through section shortcuts, and lists chronological building blocks. Organizers can edit the new public fields in Admin → Settings. Investments supports read-only past/upcoming rounds while preserving the active draft; project discovery removes opened teams, search includes roster names, and project sectors and optional self-edited bios are supported. Judging now consistently uses 0–5 with the existing 35/30/20/15 weights. A guarded transaction confirmed registration and no existing judging sheets or awards, archived the previous public details, and published the new copy while retaining window times and funding rules. Validation: 269 application/domain tests, 108 Firestore emulator tests, TypeScript and both production builds passed. Desktop and 390-pixel browser checks covered homepage navigation, rubric, roster search, sector filters, discovery exclusion, bio save/display, judge options, and round switching with an invalid unsaved draft. The live apex served the matching build and updated public metadata. The populated demo was refreshed through October 24; a new local-storage revision avoids reusing demo scores from the old scale. Production account login and a full multi-person rehearsal were not repeated. See [implementation and maintenance notes](15-september-feedback.md).

The supplied Google Form was verified to open as **Emergent Hackathon Sign Up**. Its description still says judging is around 2 p.m. Sunday, which differs from the website's 11 a.m. pitches and 1:15 p.m. awards. The form itself was not edited or submitted.

**September 22, 2026 — posters and simpler access:** Hosting, `gameCommand`, `posterVisit`, and `posterStats` were deployed. Numbered NFC links `/1` through `/99999` count Firestore visits and send a non-cacheable redirect to the homepage; organizers see counts in Admin → Posters. Sign-up now leads with Google, asks only for a name, and uses the verified account email. Admin → Access lets organizers check pending requests and assign a person to an existing or new team before approval. The attendee's Check status button fetches a fresh snapshot and reports its result. Verification: 239 tests and both production builds passed; 108 Firestore emulator tests passed; the live `/99999` test recorded exactly one visit, HEAD did not increment it, and the temporary record was removed. `/1`, `/2`, and `/3` returned the expected redirect on HEAD; an anonymous `posterStats` call returned 401. The live public homepage and Google sign-in entry point were inspected. A complete authenticated multi-person production rehearsal was not performed. See [poster tracking](13-poster-tracking.md) and [joining and approval](14-joining-and-approval.md).

**September 18, 2026 — custom domain:** Hosting and all six Functions were redeployed for `https://emergenthacks.com/`. HTTP and `www` redirect to the HTTPS apex. Both custom domains are authorized in Firebase Authentication and allowed by the default Functions CORS policy. The bare URL opens the public homepage, whose participation section has been removed; root HTML uses `no-cache` so new releases appear promptly. Verification confirmed the deployed asset matches the local build, the public schedule loads with three 30-minute funding windows, all six endpoints allow the new origin, unauthenticated protected requests are rejected, and unrelated origins are not allowed. Browser checks covered the homepage, rules and sign-in form; Google sign-in reached its account chooser without completing account authentication. All 203 tests, type checks and production builds passed. A full authenticated event rehearsal was not performed for this domain release.

**September 18, 2026 — schedule correction:** Hosting and the stored public schedule were updated to three 30-minute investment windows: Saturday 11–11:30 a.m., Saturday 9–9:30 p.m., and Sunday noon–12:30 p.m. Eastern. Building blocks are listed separately. The first-round reveal stays at Saturday 6 p.m.; the allocation deadline is independent. Community voting runs Sunday 12:30–12:45 p.m. and the winner announcement moves to 1:15 p.m. to retain 30 minutes for review. Public copy omits the restaurant name, judging administration and detailed pitch instructions. The separate correction migration preserves venue, other event metadata and all funding rules. All 203 tests and production builds passed. No Functions behavior changed in this correction.

**September 18, 2026 — event schedule:** Hosting and all six Functions were updated for editable planned windows and exact funding deadlines. The registration event now shows September 26–27 at the Nelson Center for Entrepreneurship, with a 13-item public schedule. Default funding windows are Saturday 11 a.m.–6 p.m., Saturday 9 p.m.–Sunday 10 a.m., and Sunday noon–12:15 p.m. (America/New_York). Final submissions run Sunday 10–10:45 a.m.; community voting runs 12:15–12:30 p.m. The publication transaction archived prior public details and preserved game rules and event state. Validation: 203 tests passed, production builds passed, the local organizer editor saved a revised deadline and updated the linked public row, and the public schedule was inspected at a 390-pixel mobile width. See [the schedule runbook](12-september-schedule.md).

**September 8, 2026 — historical version one:** Hosting, four original Functions, Firestore Standard in `us-west1`, Auth, organizer bootstrap and the initial registration event were deployed. Local Firebase smoke checks and infrastructure verification were completed for that release. They do not establish version-two deployment.

**September 10, 2026 — historical interface update:** Hosting and the original four Functions were updated for the compact UI, team discovery and password recovery. The September 9 recording still showed the earlier interface and trading model. Those preview/recording artifacts are not current sealed-round acceptance evidence.

**September 14, 2026 — version two deployed:** all six callable Functions, Firestore rules/indexes and the production client were deployed to `robinhacks-2026-ajs`. The guarded migration confirmed registration with zero teams and no financial history, archived the prior metadata and enabled sealed rounds while preserving the existing organizer. A repeated migration reported zero writes; the updated bootstrap also accepted the existing event without mutation.

Release verification:

- `npm run check`: TypeScript, 195 domain/application/setup/reconciliation tests, and both production builds passed.
- Isolated local Firestore emulator: 107 rules/repository tests passed.
- Local Auth/Functions/Firestore transport: nine checks passed, including verified admission, idempotency, role restrictions, sealed totals, deadline close and private team conversations.
- Read-only production verification: five checks passed for anonymous command denial, runtime data access, existing owner identity, migrated event state and the public metadata endpoint. This verifier made no application writes.
- Browser checks at 1440, 390 and 320 pixels covered allocation autosave/reload and limits, messaging/blocking, immutable final submission, judge draft persistence/submission, community voting and award-review locking. The deployed public homepage and populated demo were also inspected.

The [populated demo](https://robinhacks-2026-ajs--walkthrough-pyhnt4be.web.app/) uses browser-local fictional data; its preview expires October 24, 2026.

The organizer confirmed investor rewards apply only to the judges’ grand-prize winner. Prize amounts are not yet set, so all configured amounts remain zero/unannounced. Real event facts, the official logo asset and identified staff still need organizer input. Production Google/email sign-in and an entire hosted multi-person rehearsal were not performed; local Auth transport and browser demo checks do not replace them.

The updated `verify-firebase.mjs` validates the initial version-two state and `gamePublic`; it cannot stand in for browser Google sign-in. Some initial empty-registration assertions naturally stop applying after attendees register. Keep infrastructure verification, actual account-flow rehearsal and full event acceptance as separate checks.

### Google-only provider enforcement

Firebase CLI's Auth deployment enables configured providers but currently ignores a `false` value when disabling one. After deploying Google configuration, run the narrowly scoped script to disable email/password, anonymous, and phone sign-in and verify that Google is the only enabled federated provider:

```sh
node --env-file=.env.operations scripts/configure-google-auth.mjs --project robinhacks-2026-ajs --apply
```

Without `--apply`, it only reads the current settings. The script uses Google's [project configuration API](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v2/projects/updateConfig) with a field mask, preserving authorized domains and unrelated settings. The callable server also checks verified Google tokens against current Auth account state, so deleted or disabled accounts cannot keep using an old token.

See [the fresh event reset runbook](16-fresh-event-reset.md) for the separate, destructive reset procedure.

**September 24, 2026 — fresh registration and team selection:** Production Hosting, Firestore rules, and all seven current Functions were deployed; retired `gamePool` was deleted. Google was verified as the only enabled provider; email/password, phone, and anonymous sign-in were disabled through the configuration API. After a private local backup, the authorized reset removed three other Auth accounts and the previous event data. Read-only verification confirmed one Auth account, the owner's approved organizer membership, no teams/rounds/submissions/pending requests, and closed team selection in Registration. Public event configuration and poster counters were preserved.

Validation: 219 application tests, 114 Firestore emulator checks, and 15 real Auth/Functions transport checks passed. Browser checks exercised waiting, organizer opening, role availability, creation, joining, dashboard gating, and a 390-pixel phone layout. The live homepage and Google-only sign-in screen were inspected. Interactive Google popup sign-in could not be completed in the embedded browser (`auth/network-request-failed`); live Auth configuration, authorized domains, and the hosted handler responded successfully. The UI now gives a readable connection/retry message. Owner permissions were verified directly in Auth/Firestore; no new live participant was created for testing. The browser-local demo was republished and expires October 24, 2026.
