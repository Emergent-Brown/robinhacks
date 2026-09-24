# Resetting the event

Use this only when the owner has explicitly approved deleting the event's participants and work. Routine attendee removal belongs in **Admin → People → Remove**. That revokes event access; it keeps submitted records and private authorship history for the results audit. It does not delete someone's Google account.

The reset script is restricted to the Firebase project selected in `.firebaserc`, event `robinhacks-2026`, and the verified Google owner `shulman.aj@gmail.com`. It refuses a project containing other events because Firebase Auth users belong to the whole project.

## Preview

```sh
node --env-file=.env.operations scripts/reset-event.mjs --project robinhacks-2026-ajs
```

The default is read-only. It reports account and document counts without listing participant identities. Credentials come from the existing Firebase CLI login and are never written into the backup.

## Apply

Deploy the current server and Firestore rules first so all private operations honor the maintenance flag. Then:

```sh
node --env-file=.env.operations scripts/reset-event.mjs --project robinhacks-2026-ajs --apply
```

The script:

1. Checks the current owner and verifies the event has not changed since preflight.
2. Enables maintenance, preventing private reads and application mutations.
3. Saves an owner-readable JSON backup under ignored `backups/event-reset-…/`. This contains event data and an account identity manifest, but no passwords or tokens.
4. Deletes the event's nested records and all other Firebase Auth accounts. The owner's membership remains present throughout so a failed reset can be resumed.
5. Creates a fresh registration event, a single organizer membership, and an empty project projection. Team selection starts closed.
6. Verifies one Auth account, one membership, and no team/project records before ending maintenance.

Public event details, schedule, funding settings, and global poster counts remain. Do not commit or share the backup; it contains participant information. Auth deletions cannot be restored from the backup. People sign in again and request approval.

If the script fails after maintenance begins, resolve the reported problem and rerun it. It deliberately leaves maintenance on until verification succeeds. Keep the original backup: a retry may create another backup of partially cleared state.

## Open registration to participants

Sign in at [Emergent Hacks](https://emergenthacks.com/) with the owner's Google account. In **Admin → People**, approve attendees, add organizer Google emails as needed, then click **Start team selection** when people are ready to form teams. Close selection before opening funding.
