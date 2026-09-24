# Organizer notes, messages, and corrections

Sign in with an approved organizer Google account at [emergenthacks.com](https://emergenthacks.com/). Use **Admin** in the navigation. Organizer invitations remain under **Admin → People → Organizer emails**.

## Reach participants

- **Organizer note:** Select **Post note** next to the event status, or use the note form at the top of **Admin → Event controls**. Post a short notice, update it, or remove it. It appears above every approved participant’s page, including team selection. Concurrent edits are detected instead of silently overwriting another organizer.
- **#general:** Open **Messages**. The event-wide channel is pinned above team threads. Every approved participant, judge, and organizer can read and post; organizer messages carry a label. New messages update live. Older history is available through **Load earlier messages**. These are in-app messages, not email or push notifications.
- **Review conversations:** In **Messages → Team conversations**, search or filter by team or participant. A person’s view includes their current team’s threads and recorded prior participation. The selected thread is read-only for organizers. Use #general to speak as an organizer. Participants are told that organizers can review team chats.
- **Remove a message:** Choose **Remove** and enter a reason. The thread shows a removal notice; the original stays in the private moderation record.

## Manage teams and people

**Admin → Teams** contains team creation, project profile editing, submission correction, and deletion/withdrawal controls. **Admin → People** contains searchable people, approval, profile edits, role/team assignment, removal, and organizer invitations. Conversation shortcuts open the matching filter in Messages.

During registration, create teams and assign approved people directly, or open participant team selection. Each team has at most one approved captain and one designated investor. To replace a filled role, first move its current holder to Member, then assign the replacement. Unassigning someone returns them to team selection while keeping their approved access and #general.

After registration, pause the event before team or membership corrections. Team moves affect the live roster; past allocations, submitted rosters, and earned claims remain with the original team. New teams cannot enter once funding has started. Organizers and judges remain separate from competing teams.

A team with no funding history can be deleted during registration: its people become unassigned and its project records are removed. Once funding exists, use withdrawal, which preserves the financial record. Eligibility changes cannot alter an open round, and disqualification is not silently undone by withdrawal.

## Correct submitted work

Editing a project profile does not change the locked final submission. Before the final funding round, an organizer may reopen a submission for the team to finish. An explicit submission correction records the reason and previous evidence. If judges already scored that project, their affected entries are archived and cleared so they can review the corrected work.

Discard a prepared award preview before making corrections. Published results, settled funding, and judge scores cannot be silently overwritten through profile or membership controls. Those limits protect the result record; they do not prevent practical wrap-up notes and organizer posts in #general.

## Implementation and checks

Team corrections live in `TeamManagementService`; general chat and organizer review have separate services. The application facade supplies authenticated identity, transaction boundaries, command replay protection, and audit records. Private message pages and review directories go through authorized Functions. Firestore clients only subscribe to approved channel summaries and their permitted event/team metadata.

Tests cover organizer permissions, stale note/team/member versions, exclusive roles, moves and deletion cleanup, preserved investment authorship, submission corrections, message pagination/moderation, and direct Firestore access denial. Use the browser-local demo to practice without contacting live participants.
