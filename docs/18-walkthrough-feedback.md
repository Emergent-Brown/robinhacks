# September 25 walkthrough changes

This is the current operating guide for the rules changed by the walkthrough feedback. It supersedes earlier references to designated investors, community awards, and score-only winner selection.

## Where the controls are

- **Admin → People → Signup approval:** toggle automatic approval for new verified Google signups. It starts off. Existing pending requests and judge requests still need review. Signup closes when funding starts, as before.
- **Admin → People:** open team formation. Teams have at most four people, with one captain and up to three members. The captain invests; all members can edit the project, post checkpoints, and submit. Organizer moves cannot overfill a team. Suspended members still occupy a seat until removed or moved.
- **Admin → Judging → Judging mode:** “All projects” is the default. Every approved independent judge scores every active submitted project automatically, including new submissions. Use “Assigned projects” to choose a subset for each judge. Set the mode before anyone submits scores; compatible drafts are preserved when switching.
- **Admin → Judging → Pitch order:** move projects up or down and save. Judges see their projects in that order. New projects go at the end.
- **Admin → Judging → Judge assignments:** record conflicts in either mode. In assigned mode, choose each judge’s projects too. Every submitted, active project needs at least one non-conflicted judge.
- **Judging → Judge deliberation:** after all assigned judges submit, every judge can see the ranked scores and notes. Any assigned judge can record the agreed winner and a decision summary. Scores guide discussion; the agreed winner can differ from the numeric leader. Simultaneous decisions cannot overwrite each other silently.
- **Admin → Event controls → Judging and awards:** approve the submitted decision, review the computed awards, then publish after the review period. Corrected evidence or assignments invalidate an earlier decision.
- **Admin → Settings:** enter one total prize. Half goes to the winning team; half is the maximum investor pool. Existing weighted shares, minimum denominators, integer-cent rounding, and the unallocated-share reserve are unchanged. No community prize or second/third builder prize is awarded.

## Round timing

Schedule times are plans, not an automatic scheduler. Organizers open and close rounds in Event controls. Allocations stop at the saved deadline regardless of when the organizer closes the round to reveal totals. The readiness list identifies teams missing captains, checkpoints, or final submissions; the server checks the same requirements. A scheduled start does not bypass missing work. Changing the schedule changes future defaults, not a running round.

## Interface changes

Project editors offer existing sectors in a dropdown. Choose “Create a new sector…” to add one; matching names reuse the existing sector.

The homepage no longer shows “Silicon Valley” or community voting. The two requested fair-play sentences have been removed. Own-project pages offer an edit button when editing is open. Judges see public team rosters for every project. Messages show the sender’s team. The header has an unread-message bell and Google profile photo when available. People selectors have roomier padding.

## Reliability and capacity

Message reads coalesce duplicate requests, serialize rapid navigation, and space live updates three seconds apart. A server rate-limit response supplies a cooldown; the client honors it and keeps already loaded messages visible. Identity changes retain their existing cache isolation and server authorization checks.

The added tests cover 110 simultaneous signup attempts against the 150-person limit, competing joins for the last team seats, organizer transfer limits, judge-decision races and stale evidence, and 150 duplicate client reads. A separate **local Firestore emulator** workload exercises 150 simultaneous channel readers across 30 four-person teams (plus 30 approved unassigned attendees) and 12 simultaneous channel sends. These are correctness and local contention tests, not a production throughput guarantee.

Firebase Standard includes 50,000 document reads and 20,000 writes per day in its no-cost allowance. On Blaze, exceeding those allowances can incur charges; there is no guarantee of $0 for a busy event. Watch **Firestore → Usage** and **Cloud Run/Functions → Metrics**. An app `RATE_LIMITED` response is different from a platform 429 caused by exhausted function instances. The current function limit remains two instances. If platform metrics show queuing at that ceiling, increase `maxInstances` in `apps/functions/src/index.ts` and deploy; that increases potential cost. Do not remove per-person rate limits to compensate for an instance bottleneck.

Sources: [Firestore usage and limits](https://firebase.google.com/docs/firestore/quotas), [Firebase pricing](https://firebase.google.com/pricing), [Functions scaling and maximum instances](https://firebase.google.com/docs/functions/manage-functions).

## Release checks

Run `npm run check`, then `scripts/check-platform-emulators.mjs` through Firebase `emulators:exec` using a `demo-` project. The latter includes access-rule checks, the event-size workload, and authenticated HTTP smoke checks. Never point the stress workload at production.

`scripts/upgrade-walkthrough.mjs` updates only unlocked registration metadata, writes an ignored local backup, preserves automatic approval as off by default, and refuses to reinterpret already-announced prize amounts or retired roles. It requires `--apply` to write. No team, participant, message, project, or poster count is reset.
