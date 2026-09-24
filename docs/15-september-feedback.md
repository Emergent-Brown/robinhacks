# September 24 website feedback

This update implements the website feedback PDF and the requested homepage logistics, Emergent link, and public judging rubric. The current event is at [emergenthacks.com](https://emergenthacks.com/).

## What changed

| Area | Implementation |
| --- | --- |
| Homepage | The About card includes “Who are we?” and a link to [Emergent](https://emergentconference.org). Logistics cover the Nelson address, meals, overnight building, and what to bring. The Finish and submit step opens the rubric in a modal; the homepage has no section menu. |
| Schedule | Building blocks are split around meals, the funding reveal, and other scheduled activities. Final investments explicitly follow the hackathon-wide demos. The three funding windows remain 30 minutes by default. |
| Registration | “Join the event” opens the supplied Google Form. The header’s sign-in and the logistics section’s dashboard link still open the app’s Google sign-in and approval flow. Completing the form does not create or approve an app account. |
| Investments | Participants can select any of the three rounds. Completed allocations and upcoming rounds are read-only; the live allocation draft and autosave remain mounted when browsing history. Reward copy explains the team’s conditional share of the investor prize pool. |
| Projects | Search includes teammate names and sectors. Projects show their sector, and a sector filter narrows the list. Opened projects disappear from discovery suggestions. Discovery stays neutral rather than ranking teams by funding. |
| Profiles | Team members can publish an optional short bio beside their name. Captains and designated investors can edit the project’s sector between funding rounds, under the existing project-edit rules. |
| Judging | The homepage rubric modal shows the actual configured rubric. Judges use whole-number scores from 0 to 5; the server and export reconciliation enforce the same scale. Defaults are functionality 35%, usefulness 30%, originality 20%, and technical execution 15%. |
| Mobile navigation | Navigation labels are larger and spacing is tighter on small screens. Project discovery and filters stack to fit phone screens. |

The PDF offered alternative discovery and round-naming ideas. This release retains neutral discovery and adds explicit Round 1, Round 2, and Round 3 labels alongside the descriptive checkpoint names. Funding totals remain outside the judging formula.

## Organizer controls

Open **Admin → Settings**:

- **Public event information** contains the registration URL, contact, attendee logistics, organizer description and website, public schedule, and planned windows. Save with **Save event settings**. Public information remains editable after funding starts.
- **Funding rules and prizes → Judging rubric** contains the criterion labels and weights. Weights must total 100%. These rules lock when the first funding round opens; the score scale is fixed at 0–5.

App access is managed separately in **Admin → Access → Approve**. See [Joining and approval](14-joining-and-approval.md).

Participants add or edit their own bio in **My team → Team members**. Bios are optional, limited to 280 characters, and visible on the team’s project page. Saving an empty bio removes it. The project sector is under **My team → Edit project**.

## Code and release notes

- [Homepage](../apps/web/src/platform/Homepage.tsx), [event information editor](../apps/web/src/platform/EventInfoEditor.tsx), and [schedule defaults](../packages/core/src/event-schedule.ts) keep public presentation separate from editable event data.
- [JudgingRubric](../apps/web/src/platform/JudgingRubric.tsx) reads configured weights; [judging helpers](../packages/core/src/judging.ts) define the shared score range.
- [Investments](../apps/web/src/platform/Investments.tsx) separates historical entitlements from the active allocation editor. Changing the selected round does not reset a pending allocation.
- [Project discovery](../apps/web/src/platform/project-discovery.ts) owns search, sector filtering, and browsing history. Visits are scoped to the event and account on the current device, with an in-memory fallback when browser storage is unavailable.
- [ProfileService](../packages/application/src/services/profile-service.ts) permits approved participants to edit only their own bio. Project-sector edits retain the existing role, version, funding-window, and final-submission checks.

[The publication script](../scripts/publish-september-feedback.mjs) updates the existing event’s registration link, schedule copy, logistics, and organization fields. Run its read-only preflight first:

```sh
node --env-file=.env.operations scripts/publish-september-feedback.mjs --project robinhacks-2026-ajs
```

Add `--apply` to publish. The script requires the configured project and an approved organizer login. It only proceeds while the event is in registration with no funding rounds, locked rules, judging sheets, or award results. This prevents silently changing the scoring scale over existing scores. It archives the previous public details, writes an audit entry, preserves actual planned window times and funding rules, and skips already-applied migrations so reruns do not overwrite later organizer edits.

269 application/domain tests, 108 Firestore emulator checks, and both production builds passed. Deployment and browser verification are recorded in [Firebase setup](FIREBASE-SETUP.md#deployment-record).
