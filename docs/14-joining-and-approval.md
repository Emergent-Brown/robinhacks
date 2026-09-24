# Joining, approval, and team selection

**Join the event** opens the event registration form. App access is separate: open [emergenthacks.com](https://emergenthacks.com/) and choose **Sign in → Continue with Google**. Confirm your name and verified account email, then send the access request. Signup asks for no team or role, and has no password option.

While the request is pending, **Check status** fetches a fresh result and shows when it was checked. Return using the same Google account. A verified email identifies the account; an organizer still approves attendance.

## For attendees

1. Send your name and verified Google email for approval.
2. After approval, wait on the team-selection screen until the organizer opens selection. The project, investment, and messaging pages become available after you join a team.
3. Choose **Join a team** or **Create a team**, then select your role. Creating a team does not automatically make you captain.
4. Each team can have one **Captain**, one **Designated investor**, and multiple **Members**. Taken roles are disabled. The server checks role availability again when you join, including when two people choose the same role together.
5. Continue to **My team**. A captain must be in place before funding begins. Ask an organizer to correct a mistaken team assignment.

The captain manages team roles, project details, and investments. The designated investor can also edit the project and shared allocation. Members help build and can view their team's investments. All use separate Google accounts.

## For organizers

Sign in with your organizer Google account and open **Admin → Access**. On mobile, Admin is under **More**. [Open Admin directly](https://emergenthacks.com/#/platformadmin).

- **Approve attendees:** Select **Check for sign-ups**, review the verified name and email, then select **Approve**. Approval does not choose or create their team.
- **Start team selection:** The Team selection panel shows how many approved people are unassigned. Select **Start team selection** and confirm. You can close and reopen selection during unpaused registration. Closing leaves unassigned attendees on the waiting screen.
- **Check readiness:** Ensure each participating team has a captain and the required checkpoint, then close team selection before opening funding. The first funding round locks competing rosters.
- **Add an organizer:** Under **Organizer emails**, enter their Google account email, review the access grant, and confirm. They receive organizer access on their next Google sign-in or refresh. This creates no email message. A competing team account must be removed from its team before receiving staff access.
- **Assign a judge:** Approve the person first, then change their unassigned membership to Judge. Judges and organizers skip team selection and do not receive team investment accounts.
- **Remove access:** Select **Remove** next to the person, check the name and email in the confirmation, and confirm. This removes their event membership, request, team-member record, and matching organizer invitation. Their project, investments, and submitted records stay. Outside registration, pause the event first.
- **Replace a missing captain or investor:** After funding starts, pause the event and use an approved existing teammate’s role menu to fill an empty captain or designated-investor slot. Filled roles cannot be swapped, and this does not admit new teammates or change team funding.
- **Remove an organizer email:** This revokes both the invitation and matching existing organizer membership. It is not just removing a reminder from a list. You cannot remove yourself or the last approved organizer.

Participants cannot approve themselves or select an organizer role during signup. All privileged commands require a verified Google identity and approved organizer membership; permissions, phase restrictions, role limits, and version checks run on the server. Changes are audited.

## Where the implementation lives

- [Access](../apps/web/src/platform/Access.tsx): Google sign-in, identity-only signup, and pending status.
- [TeamFormation](../apps/web/src/platform/TeamFormation.tsx): waiting, team choice, available roles, and joining.
- [AdminMembers](../apps/web/src/platform/AdminMembers.tsx): approvals, formation controls, removal, and organizer emails.
- [TeamFormationService](../packages/application/src/services/team-formation-service.ts): atomic membership and role selection.
- [OrganizerAccessService](../packages/application/src/services/organizer-access-service.ts): email invitations and protected access removal.

The team-selection snapshot contains only team names, roster names and roles, and role availability. Unassigned attendees do not receive normal project, funding, message, or judging data. Organizer invitation emails are visible only to organizers.
