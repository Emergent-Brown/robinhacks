# Firebase setup and deployment

This guide describes the actual RobinHacks project, not an example project. The live application is ready for participant registration.

## Configured resources

| Resource | Value |
| --- | --- |
| Project | `robinhacks-2026-ajs` |
| Firebase console | [Open project](https://console.firebase.google.com/project/robinhacks-2026-ajs/overview) |
| Hosting URL | [RobinHacks](https://robinhacks-2026-ajs.web.app) |
| Event ID | `robinhacks-2026` |
| Database | `(default)`, Firestore **Standard**, `us-west1`, free-tier eligible |
| Web app | `RobinHacks`, app ID `1:594324444355:web:beae64a96445b8e3707e76` |
| Sign-in | Google and email/password |
| Organizer | Configured verified Google identity; separate from competing teams |
| Billing | Blaze, linked to an owner-managed billing account |
| Backend | `gameCommand`, `gameSnapshot`, `gamePool`, `gameExport`, second-generation callables in `us-west1` |

Firestore, Authentication, billing and the initial organizer/event were provisioned on September 8, 2026. The event starts in **Registration**, with no example teams or fake participant accounts in production. Browser demo and emulator fixtures are separate.

## Reproduce the web configuration

The SDK configuration has already been downloaded into the ignored file `apps/web/.env.production` on this machine. Firebase web API keys identify the project; they are not administrator credentials. No service-account key is required by the frontend or committed to this repository.

On another machine:

```sh
npm ci
npx -y firebase-tools@latest login
npx -y firebase-tools@latest use robinhacks-2026-ajs
npx -y firebase-tools@latest apps:sdkconfig WEB 1:594324444355:web:beae64a96445b8e3707e76 --project robinhacks-2026-ajs
```

Create `apps/web/.env.production` from the returned configuration:

```dotenv
VITE_APP_MODE=firebase
VITE_EVENT_ID=robinhacks-2026
VITE_FIREBASE_REGION=us-west1
VITE_FIREBASE_PROJECT_ID=robinhacks-2026-ajs
VITE_FIREBASE_AUTH_DOMAIN=robinhacks-2026-ajs.firebaseapp.com
VITE_FIREBASE_APP_ID=1:594324444355:web:beae64a96445b8e3707e76
VITE_FIREBASE_API_KEY=copy-the-apiKey-returned-by-the-command
```

`npm run dev` uses local demo mode by default. Vite production builds load `.env.production`. Avoid setting `VITE_APP_MODE=demo` in your shell when deploying; environment variables override the file. Never put admin credentials in a `VITE_` variable.

## Organizer initialization

The initial event and organizer role are already created. Sign in with the configured organizer Google account. This account can approve participants, control phases, and publish results. There is no organizer password embedded in the application.

Copy the operations example, then set `ROBINHACKS_ORGANIZER_EMAIL` to that same Google account in the ignored local file:

```sh
cp .env.operations.example .env.operations
```

The bootstrap and verification scripts require this explicit identity and verify it against the Firebase CLI login. The email is operational configuration, not a credential. Do not add passwords or tokens to this file.

The setup script is idempotent and defaults to read-only preflight:

```sh
node --env-file=.env.operations scripts/bootstrap-firebase.mjs --project robinhacks-2026-ajs
```

Only when creating the initial event in an otherwise empty configured project:

```sh
node --env-file=.env.operations scripts/bootstrap-firebase.mjs --project robinhacks-2026-ajs --apply
```

It verifies the live Google identity behind the Firebase CLI login, links that exact Google provider identity, and atomically creates the registration event, empty market projection, and separate organizer membership. Existing event records and permissions are never overwritten. It uses the CLI’s existing session; it does not create a service-account key or publish a bootstrap endpoint. The CLI adapter uses internal Firebase CLI APIs, so rerun preflight after upgrading the CLI; `FIREBASE_TOOLS_DIR` can point to a compatible installed package if discovery selects an older cached version.

## Deploy and verify

```sh
npm run check
npm run deploy
```

`npm run deploy` builds the web client and server bundle, then deploys Hosting, Firestore rules/indexes and Functions to the project selected in `.firebaserc`. Auth configuration is kept separately in the ignored `firebase.auth.local.json`, so routine deployments do not reapply it. To configure Auth on another workstation, copy the example and replace the Google provider’s `supportEmail` with the project’s approved support address:

```sh
cp firebase.auth.example.json firebase.auth.local.json
```

Review the authorized domains and support email, then deliberately deploy the local Auth configuration:

```sh
npx -y firebase-tools@latest deploy --config firebase.auth.local.json --only auth --project robinhacks-2026-ajs
```

The existing local Auth configuration is already populated on the original workstation; keep that file instead of overwriting it with the example.

The standalone `apps/functions/package-lock.json` pins the server install used by Cloud Build. If server dependencies change, regenerate it with `npm install --package-lock-only --workspaces=false` in that directory, then test and deploy. The root lockfile pins the local workspace. Both carry the patched UUID override required by the current Firebase Admin dependency tree.

After deployment, open the Hosting URL, sign in with your organizer Google account, and verify **Admin → Teams & access**. Participants sign in and request access; approve their real identities and team assignments. Approving a new captain creates the team and its initial wallet/exchange. Approve at least two active teams before opening funding. Use local emulators for rehearsal data rather than filling the production roster with sample teams.

## If a Firebase step fails

| Error | Concrete action |
| --- | --- |
| Project must be on Blaze | Open [Usage and billing](https://console.firebase.google.com/project/robinhacks-2026-ajs/usage/details), verify the selected billing account is active, then rerun `npm run deploy`. |
| CLI login expired or bootstrap cannot verify Google identity | Run `npx -y firebase-tools@latest login --reauth`, then `npx -y firebase-tools@latest login:use your-organizer@example.com` (using the account configured in `.env.operations`) and rerun the read-only bootstrap command. |
| Google sign-in says unauthorized domain | Add the actual app domain in [Authentication settings](https://console.firebase.google.com/project/robinhacks-2026-ajs/authentication/settings). The two Firebase Hosting domains and localhost are configured already. |
| Google popup blocked | Allow the sign-in popup and try again in a normal browser tab. |
| Event not configured | Run the read-only bootstrap command. Apply only if it reports that the event is absent and the proposed organizer matches. |
| Functions fail during first deployment | Check the CLI error and [Cloud Build history](https://console.cloud.google.com/cloud-build/builds?project=robinhacks-2026-ajs). Newly enabled service identities may take several minutes to propagate; rerun the deployment after propagation. |
| Emulator reports Java requirement | Install Java 21+. On macOS the runner selects JDK 21; elsewhere set `JAVA_HOME` and `PATH` to that installation. |
| Port already in use | Stop another emulator process. For a Vite-only conflict use `WEB_PORT=5174 npm run dev:firebase`. |

## Cost controls and App Check

Normal pilot usage targets no-cost allowances, but **Blaze is not a spending cap**. Deployments, artifacts, network traffic and usage beyond allowances can incur charges. Each of the four callables has zero minimum instances, at most two instances, 256 MiB memory and a 60-second timeout. A one-day Artifact Registry cleanup policy removes old generated deployment images. Gameplay is bounded to 30 teams, 150 approved participants, three windows and 15 successful trades per team per window. Background market updates come from a visible organizer session every two minutes; hidden clients stop public market listeners.

Configure a small project-scoped budget and alerts in [Cloud Billing budgets](https://console.cloud.google.com/billing/budgets?project=robinhacks-2026-ajs), and inspect actual usage during rehearsal. Budget alerts do not stop spending. Callable burst limits are per instance and user; they are not hard global quotas. The original planning estimate in `06-cost-and-platform.md` is not a measured production bill.

Auth, explicit membership approval and deny-by-default Firestore rules are active. **App Check is optional and not enforced in this initial deployment.** To add it, register this web app with a reCAPTCHA Enterprise site key in [Firebase App Check](https://console.firebase.google.com/project/robinhacks-2026-ajs/appcheck), set `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` in the web environment, rebuild and verify valid tokens. Then add `ENFORCE_APP_CHECK=true` to `apps/functions/.env.robinhacks-2026-ajs` and redeploy Functions. Enable enforcement only after verifying normal sign-in and trading still work.

For a custom domain, update Authentication’s authorized domains. The default callable CORS policy permits Firebase Hosting domains and localhost. Set `ALLOWED_ORIGINS=https://your-domain.example,https://robinhacks-2026-ajs.web.app` in the Functions environment before deploying a custom domain.

## Deployment record

Hosting and all four Functions deployed successfully on September 8, 2026. The live URL is [RobinHacks](https://robinhacks-2026-ajs.web.app). Firestore reports Standard edition, `us-west1`, free-tier eligibility. The organizer event initialization completed successfully. Artifact Registry has a one-day cleanup policy for generated function images.

On September 10, Hosting and all four Functions were updated with the redesigned interface, private existing-team discovery, late membership requests and password recovery. The populated preview channel was also refreshed and expires October 9, 2026. The September 9 walkthrough video still shows the earlier interface; its player links to the current demo. No production event records or organizer permissions were changed.

Current validation: 77 domain/application tests and 84 Firestore security/transaction tests pass. Type checking, production builds and formatting checks pass. Browser checks cover buying, selling, team access, password-recovery form behavior and organizer score review at desktop, 390 px and 320 px widths. Password-recovery browser checks used a mock gateway and did not send email. The published sign-in screen and demo render successfully. The original deployment also passed seven real local Auth/Functions smoke checks and a production dependency audit with zero known vulnerabilities; those checks were not rerun for this interface update.

Production checks confirmed HTTPS Hosting and its JS/CSS assets return 200, security headers are present, the deployed login screen renders, and unauthenticated commands return `SIGN_IN_REQUIRED`. The verified organizer Auth identity is linked to Google. The Firebase CLI OAuth client cannot stand in for the web app’s Google client, so an interactive production Google sign-in still needs to be checked in the owner’s browser. All sign-in and callable flows were exercised with real local Firebase emulators.

The read-only `node --env-file=.env.operations scripts/verify-firebase.mjs` command passed four production infrastructure checks, including the initial event/organizer documents and the runtime service account’s Firestore access. It checks the initial empty-registration state; after real teams register, that specific initial-state assertion is expected to fail. It does not claim to verify an authenticated browser callable.
