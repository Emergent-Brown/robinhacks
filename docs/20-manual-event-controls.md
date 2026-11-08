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

Registration stays open during building and investment rounds. Late arrivals sign in
with Google and send their name and email. Approve them in **Admin → People →
Pending approvals**, then add them to an existing team. Late requests always need
review, even if automatic approval was enabled before funding. Signup and approval
close when results review begins.

Before funding, approve attendees, then open team selection when ready. Approved participants
create or join teams before entering the main app. Close selection before
opening the first funding round. To add an approved person who is still waiting
for a team during the event, use **Admin → People → Edit person / team**, select
the team and an available role, then **Save team and role**. No pause is needed.
The four-person limit still applies. Moving an existing teammate or changing
their role requires a pause. Published and award-review rosters remain locked.

Use **Admin → Teams → Create team** to create a late team without pausing, then
assign its captain and teammates in People. It can join future funding rounds;
creating it does not change the eligible teams, budgets, or credits in rounds
that have already opened. Results review and published events remain locked.

## Manual event controls

Teams can add optional resources under **My team → Edit project → Additional links**.
Choose or type a label (such as Demo video, GitHub, or Website), enter the full
HTTP/HTTPS URL, then save the project. Up to eight additional links appear on
the project profile. Existing profile locks still apply during funding and after
final submission. Final submissions preserve these links for judges; organizers
can correct submitted links through the existing paused evidence-correction flow.

Funding rounds, final submissions, and the community ballot open and close only
when an organizer presses the corresponding control. There is no duration input,
automatic cutoff, or countdown. A round remains open past suggested times until
someone closes it. If checkpoints are missing, **Open next round** names those
teams and asks you to confirm opening anyway. They remain eligible to invest and
receive funding and can publish their first checkpoint for that round while it is
open, from **My team → Publish a checkpoint update**. A team with an existing
checkpoint cannot edit or replace it during the round. Closed rounds stay locked. The
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
