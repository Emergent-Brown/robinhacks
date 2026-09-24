# Event-readiness audit

Reviewed September 14, 2026, against the sealed-round implementation for 10–30 teams and up to 150 participants. [11 · Sealed rounds](11-sealed-rounds.md) is the current product and technical specification. See [architecture](architecture.md) for current implementation boundaries.

**The requested application capabilities are implemented. Real event details, staffing, prize commitments and an end-to-end production rehearsal still need organizer confirmation.** The client, backend and rules were deployed and the empty production event was migrated on September 14; the deployment record contains the verification evidence. A full hosted pilot is still separate from these checks.

## Implemented since the previous audit

The three former priorities are now covered in the application: separate backup-organizer approval, verified participant email identity, and durable independent judging drafts. Team rosters lock at the first funding round; judges and organizers use separate team-less accounts. Staff approval does not give a team extra credits.

The meeting changes are implemented across the homepage and event settings, Emergent Hacks naming, first-use onboarding, project discovery, public team rosters, archived updates, private team conversations, formal immutable submissions, an independent judge portal and a private community ballot. Projects support sectors, teammate search and optional bios. The application uses sealed funding rounds.

The investing model is now three sealed, amount-based allocation rounds with expiring budgets, a concentration limit, separate fixed round entitlements and the minimum funding denominator. Current allocations are private, including from organizers. Judges cannot inspect funding totals while judging. Builder prizes, the grand-prize investor pool and the community award remain separate. Awards require complete eligible judging coverage, a reviewed preview and an explicit publication step.

## Confirm before announcing the event

| Item | What remains | Where it is handled |
| --- | --- | --- |
| Event facts | Confirm date, venue, time zone, eligibility, registration destination, schedule and support contact. Empty fields must not be presented as established facts. | Admin → Settings and public homepage |
| Branding asset | Supply/confirm the official Emergent logo asset. The product name is implemented; a guessed logo should not be represented as official. | Frontend brand asset |
| Prize commitments | Confirm actual builder prizes, investor reserve, community prize and destination of unallocated rewards. Current prize defaults are zero. | Admin → Settings, before round one |
| Judging policy | Confirm the published rubric, grand-prize tiebreak procedure and results-review duration. Explain remaining exact-score ties and the community ballot tie order. | Admin → Settings and event rules |
| Event staff | Name, verify and approve the actual backup organizer and judges; assign every eligible submission to a non-conflicted judge. | Admin → Access / Judging |
| Pilot | Rehearse the complete hosted event flow with actual organizer/judge browser sign-in and a separate test event or local fixtures. | Organizer acceptance rehearsal |

The named staff roles and approval controls exist. No additional real judge or backup organizer account should be granted access without the organizer identifying the person.

## Rehearsal acceptance checklist

- Open the public homepage signed out; confirm every published event fact and prize statement.
- Sign in through Google, send an identity-only request, and approve it independently of team assignment. Open team selection, create and join teams with distinct roles, and confirm unassigned participants cannot enter the workspace. Exercise organizer email invitations and protected access removal.
- Confirm a teammate shares the same allocation sheet; a judge or organizer receives no competing wallet. Verify the backup organizer can operate the event.
- Have at least two teams publish initial checkpoints. Open a round, edit allocations from two tabs, confirm conflict handling and the private view from every role.
- Pause and resume an active deadline; confirm the same remaining time is restored for everyone. Close at the deadline and inspect immutable entitlements.
- Exchange team messages, block a conversation, report a selected message, and confirm unrelated teams and judges cannot read the conversation, while organizers can review it through the disclosed review interface.
- Submit final code commit and demo evidence before the final round. Confirm edits and late submissions are rejected after the relevant lock.
- Assign independent judges, declare a conflict, reload saved drafts, submit complete sheets and confirm scores lock.
- Submit private team ballots, close voting, prepare awards and inspect original scores, rankings, exact investor totals and reserve. Confirm publication cannot bypass the review delay.
- Publish, export and independently reconcile the record. Prize transfer is an organizer process outside this application.

## Intentional operating limits

This is a single configured hackathon, not a general event marketplace. Funding opens manually at announced checkpoints; deadlines are enforced on the server. It has no resale, price chart, order book, private share transfer or payment processor. Funding receipts do not finance a team's spending account. An official project update and the final submission are different records.

Current messages are bounded to 250 per conversation and 1,000 characters, with one send per five seconds for the whole team. Ordinary messaging remains available during building periods. Reports flag a selected message for attention. Organizers can also review complete team conversations, with this access disclosed in each thread. #general is shared with all approved identities, including unassigned attendees. There are at most 50 judge assignment records, with notes bounded to 1,500 characters per project. Submitted judge sheets lock; organizers cannot quietly rewrite a submitted score. A revealed funding round can be voided as a whole and cannot be replayed.

These are implemented product choices, not missing prerequisites. A full production rehearsal has not yet been confirmed. Automated validation, deployment and migration outcomes should be recorded in the [Firebase deployment record](FIREBASE-SETUP.md#deployment-record) only after they complete.
