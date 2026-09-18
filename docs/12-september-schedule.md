# September 26–27 event plan

Venue: Nelson Center for Entrepreneurship. All times use America/New_York (EDT).

| Window | Opens | Closes |
| --- | --- | --- |
| Initial pitch investments | Saturday 11 a.m. | Saturday 11:30 a.m. |
| Working prototype investments | Saturday 9 p.m. | Saturday 9:30 p.m. |
| Final submissions | Sunday 10 a.m. | Sunday 10:45 a.m. |
| Final demo investments | Sunday noon | Sunday 12:30 p.m. |
| Community ballot | Sunday 12:30 p.m. | Sunday 12:45 p.m. |

Each investment round lasts 30 minutes. The first follows team forming and initial pitches; the other two follow longer building periods. Building runs Saturday 11:30 a.m.–9 p.m. and Saturday 9:30 p.m.–Sunday 10:45 a.m., with meal and social breaks.

The public schedule lists welcome/team forming at 10 a.m., lunch at noon, the first funding reveal at 6 p.m., dinner at 7 p.m., an ice cream social at midnight, breakfast at 8 a.m., pitches Sunday 11 a.m.–noon, winners at 1:15 p.m. and the closing ceremony at 2 p.m. Restaurant names, judging administration and detailed pitch instructions are omitted from the public schedule.

Organizer notes: the original dinner plan was ESP from 7–9 p.m.; the social can run until 2 a.m. Pitch Q&A allows up to three audience questions with answers capped at 30 seconds each. Confirm these arrangements separately.

The final investment round follows pitches. Judges finish scoring and teams vote by 12:45, leaving the existing 30-minute results review before the 1:15 p.m. announcement. This is 15 minutes later than the original draft so all three rounds get 30 minutes without cutting review time. For a larger turnout, extend pitches and move the final round, voting and awards together. The 100-credit rules remain unchanged.

The first investment deadline is 11:30 a.m. Saturday. Wait until the scheduled 6 p.m. reveal to close that round in Event controls: allocations stop at the deadline even while totals remain sealed. Close round two after 9:30 p.m. and round three after 12:30 p.m. Sunday. The public 6 p.m. reveal label is editable independently of the investment deadline.

## Organizer controls

In **Admin → Settings**, edit the date, venue, time zone, schedule items and planned windows. Linked rows follow their window's times automatically. Custom labels cover meals, pitches and other activities and remain independently editable. Rows can be added, removed or reordered.

In **Admin → Event controls**, open windows manually. The default uses the planned deadline, so opening late does not shift every later activity. For an early start, more time, or rehearsal on another date, choose **Open now for a custom duration**. Expired plans cannot open accidentally. Checkpoints, final submissions and judging prerequisites still apply.

Opened windows keep their own deadlines. Editing the plan neither changes those deadlines nor reopens completed rounds. Pause/resume preserves remaining time. Organizers close funding at or after the deadline to reveal totals. Funding rules and the rubric lock at round one; schedule metadata remains editable.

## Implementation and deployment

`EventSchedule` owns defaults, event-zone conversion and validation. `EventScheduleEditor` handles schedule rows and planned windows; `WindowOpener` handles funding, submissions and ballots. `details.timing` and linked row keys are optional for older events. The server rejects overlapping rounds, submissions after the final round starts, ballots before funding ends, and expired or overly distant live deadlines.

Deploy updated Functions and Hosting, then publish the plan with the existing organizer CLI login:

```sh
node --env-file=.env.operations scripts/update-september-schedule.mjs --project robinhacks-2026-ajs
node --env-file=.env.operations scripts/update-september-schedule.mjs --project robinhacks-2026-ajs --apply
```

The first command is read-only. Apply requires registration with no opened rounds, stores the previous public details, updates only schedule and planned-window fields, and records an audit entry. Identities, teams, allocations and funding rules are preserved. The `september-2026-schedule-short-rounds` migration marker makes reruns no-ops so they cannot overwrite later organizer edits.
