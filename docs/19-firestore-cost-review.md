# Firestore cost review — November 5, 2026

## Finding and measured change

Reviewed and retained teammate commit `93b0f9f` (40-team capacity, read-only
snapshots, refresh scheduling, retries, and a shared-command queue). It reduced
the number of refreshes, but each refresh still loaded full collections.

The emulator benchmark seeds 40 teams, 160 participants, an organizer, 120
project updates, 40 submissions, and three rounds. It compares 100 simultaneous
participant snapshots using the same service and data:

| Measure | Source collections | Server read pages |
| --- | ---: | ---: |
| Document reads | 37,500 | 2,400 |
| Reads per snapshot | 375 | 24 |
| Reduction | | 93.6% |

All returned snapshots must be deeply equal. The baseline includes the
teammate's improvements; refresh suppression provides additional savings not
counted here. The benchmark counts repository document reads, including missing
documents and empty queries. It is not a billing export or a production latency
measurement. It excludes browser listeners, other endpoints, projection writes,
network transfer, and function compute.

Cloud Monitoring reported 389 document reads and 15 writes for the 24-hour
window inspected before deployment. That did not indicate an existing runaway
bill. The larger concern was event traffic.

Firestore's free allowance is 50,000 reads/day. Blaze permits paid usage beyond
that allowance; it is not a hard daily read cap. Twenty refreshes by 100 people
would use about 48,000 snapshot reads in this fixture, versus 750,000 before.
Other operations still add usage. See [Firestore pricing](https://firebase.google.com/docs/firestore/pricing).

## Implementation and boundaries

`FirestoreRepository` maintains paged copies of teams, members, project updates,
and submissions. Each source mutation and its page updates commit in the same
Firestore transaction. Pages contain at most 100 rows, targeting 200 KB each.
The large page array is exempt from indexing. No browser can read these pages
directly; the existing server response filtering still applies.

Read-only collection queries use the pages. Missing or incomplete pages and
collections that reach their safety bound fall back to source queries. Individual
member reads, command validation, investments, messages, and audit exports keep
using authoritative records. Disabling a participant takes effect without
waiting for a page refresh. Rebuilding pages adds some writes and reads when
source records change; it avoids repeating hundreds of reads for every viewer.

The frontend retains the teammate's debounced refreshes and local allocation
updates. Additional fixes refresh judges when sheets change, respect the server's
retry cooldown, clear scheduled state on account changes, prevent retries from
switching identities, and avoid applying late saves to a new account's cache.
Failed allocation saves invalidate the local version. The command queue now
starts its timeout when work begins, avoiding simultaneous release of a backlog.
Profile edits use that queue because they now update shared member pages.

Existing zero-minimum-instance settings and bounded maximum instance counts
remain. This reduces idle compute; it does not impose a hard spending cap.

## Deployment and maintenance

Deploy the backend before backfilling, so all subsequent application mutations
maintain the pages. Then use the existing ignored organizer configuration:

```sh
# Inspect counts without changing records.
node --env-file=.env.operations scripts/rebuild-read-views.mjs
# Rebuild derived pages, then compare them with sources.
node --env-file=.env.operations scripts/rebuild-read-views.mjs --apply --verify
# Read-only consistency check.
node --env-file=.env.operations scripts/rebuild-read-views.mjs --verify
```

The script targets only the configured production project and event. It prints
counts and match results, never participant records. **Run a rebuild after any
direct Firestore console edit, import, restore, or administrative script that
changes these collections outside `FirestoreRepository`.** Normal organizer
controls maintain the pages automatically. Do not deploy an older writer without
also disabling/removing the derived views; old writers cannot keep them current.

## Validation

- `npm run check`: 299 tests passed, type checking and both builds passed;
  emulator-only tests skip outside the emulator.
- Firebase emulator suite: 145 tests passed, covering security rules, 150
  concurrent message readers, concurrent sends, and the 100-reader cost comparison.
- 17 callable transport checks passed, including signup/approval, formation,
  message visibility, moderation, account deletion, and atomic round close.
- Further regression checks cover account switches during retry/autosave,
  queue backlog timeouts, projection insert/update/delete, missing pages,
  oversized source collections, and immediate access revocation.

For a repeatable cost measurement, run `tests/firestore-cost.test.ts` inside the
Firestore emulator with project `demo-robinhacks`. Set `READ_COST_REPORT` to an
ignored local JSON path to retain the measured counts. The complete callable
suite is `node scripts/check-platform-emulators.mjs` inside Auth, Firestore, and
Functions emulators. Never point load-test fixtures at production.

## Production verification

Deployed the Functions, Hosting build, and index exemption on November 5. The
post-deployment backfill matched all four source collections: four teams, 17
members, one project update, and no submissions. No source records were changed.
The live site and walkthrough returned the exact newly built JavaScript assets.
The public callable still withheld private records, and unauthenticated commands
were rejected. The walkthrough preview was renewed for 30 days.
