# Running Emergent Hacks

Sign in with Google at [emergenthacks.com](https://emergenthacks.com). The fresh
event starts with **shulman.aj@gmail.com** as its only organizer.

## Organizers and participants

In **Admin → People**, paste up to 50 organizer emails, separated by commas or
new lines. Review the confirmation, then grant access. Existing verified members
become organizers immediately and appear in the organizer section, outside the
main member list and approval queue. New organizers sign in using the exact
invited Google email; they do not need participant approval.

Promoting a competing participant removes their team role. If they were captain,
use the team controls to appoint a replacement. During the event, pause before
promoting a team member or judge. Their roles stay locked once awards review
begins. Adding a new staff email does not require a pause.

Approve attendees, then open team selection when ready. Approved participants
create or join teams before entering the main app. Close selection before
opening the first funding round.

## Manual event controls

Funding rounds, final submissions, and the community ballot open and close only
when an organizer presses the corresponding control. There is no duration input,
automatic cutoff, or countdown. A round remains open past suggested times until
someone closes it. If checkpoints are missing, **Open next round** names those
teams and asks you to confirm opening anyway. They remain eligible to invest and
receive funding, but cannot add a checkpoint for that round after it opens. The
audit record lists any missing checkpoints you confirmed. Approved captains and
round-three final submissions remain required. Closing commits all allocations
atomically.

The suggested round schedule is available to organizers for planning. Changing
that schedule never changes event state. General event information, meals, and
logistics can remain on the public homepage.

Post an organizer note for persistent instructions. Use pinned **#general** to
send a message to everyone. In Messages, organizers can inspect conversations by
team or participant and moderate messages with an attributed removal notice.

## Assigning judges

Judges always review their explicit assignments. In **Admin → Judging**, use
**Assign all** to give every eligible project to every judge, or the automatic
split to distribute projects. Review the assignments and adjust individual
judges as needed. Declared conflicts remain excluded.

Judges complete a rubric sheet for their assigned projects and see rankings
after submitting. Organizer review combines the submitted sheets. Any assigned
judge may record the deliberated winner. Prize amounts and the existing
unallocated-share reserve still follow the event's configured funding rules.

## Reset and maintenance

The owner-authorized reset deletes event memberships, teams, project records,
messages, judge assignments, scores, allocations, receipts, and invitations, and
deletes every other Firebase Auth account. The owner's verified Google identity
is retained. Public event details, sponsors, logistics, and global poster visit
counts are retained. A private local backup is saved before deletion.

Use the restricted [reset script](16-fresh-event-reset.md) only for an explicitly
authorized fresh start. After any direct data reset or import, run the
[read-page rebuild](19-firestore-cost-review.md#deployment-and-maintenance).
Normal organizer actions maintain those pages automatically.

## November 6 verification

The live site and populated demo were deployed with these controls. The reset
completed with one Firebase Auth account and one approved organizer membership,
zero teams, zero project submissions, and no pending access requests. Read pages
were rebuilt and compared with their source collections. Public assets match the
new builds; anonymous mutation requests remain denied.

Validation passed: 301 unit tests, 145 Firebase emulator tests, and 18 callable
checks. Browser checks covered 78 desktop/tablet/phone layouts, plus bulk
organizer promotion, pagination, immediate round closing, assignment splitting,
score submission, ranking, winner selection, award review, publication, and
mobile results. Tests and video captures use separate demo data.
