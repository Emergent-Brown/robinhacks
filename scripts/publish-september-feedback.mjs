#!/usr/bin/env node
/** One-time publication of September 24 feedback. Reruns preserve organizer edits. */
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Firestore } from 'firebase-admin/firestore';
import { OAuth2Client } from 'google-auth-library';
import { cliCredential } from './bootstrap-firebase.mjs';

const assert = (value, message) => {
  if (!value) throw new Error(message);
};
async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  assert(
    args[0] === '--project' && args.length === (apply ? 3 : 2) && (!apply || args[2] === '--apply'),
    'Usage: node --env-file=.env.operations scripts/publish-september-feedback.mjs --project <configured-project> [--apply]',
  );
  const project = args[1];
  const configuration = JSON.parse(await readFile('.firebaserc', 'utf8'));
  assert(project === configuration.projects.default, 'Project must match .firebaserc.');
  assert(
    !process.env.FIREBASE_TOKEN &&
      !process.env.FIRESTORE_EMULATOR_HOST &&
      !process.env.FIREBASE_AUTH_EMULATOR_HOST,
    'Unset token and emulator overrides.',
  );
  const { credential, identity } = await cliCredential();
  const app = initializeApp({ projectId: project, credential }, 'feedback-publication');
  const oauth = new OAuth2Client();
  oauth.refreshHandler = async () => {
    const token = await credential.getAccessToken();
    return { access_token: token.access_token, expiry_date: Date.now() + token.expires_in * 1000 };
  };
  const db = new Firestore({ projectId: project, authClient: oauth, preferRest: true });
  try {
    const owner = await getAuth(app).getUserByEmail(identity.email);
    const bundle = await build({
      entryPoints: ['packages/core/src/event-schedule.ts'],
      bundle: true,
      format: 'esm',
      platform: 'node',
      write: false,
    });
    const { defaultEventDetails, EventSchedule } = await import(
      'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
    );
    const plan = defaultEventDetails();
    EventSchedule.validate(plan.timing);
    const root = db.doc('events/robinhacks-2026');
    const marker = root.collection('migrations').doc('september-2026-website-feedback');
    const report = await db.runTransaction(async (tx) => {
      const [snapshot, membership, previous, sheets, awards] = await Promise.all([
        tx.get(root),
        tx.get(root.collection('members').doc(owner.uid)),
        tx.get(marker),
        tx.get(root.collection('judgingSheets').limit(1)),
        tx.get(root.collection('awardResults').limit(1)),
      ]);
      const member = membership.data(),
        event = snapshot.data();
      assert(
        member?.role === 'organizer' && member.status === 'approved' && member.teamId === null,
        'The current login must be an approved separate organizer.',
      );
      assert(event?.platform?.version === 2, 'A version-two event must exist.');
      if (previous.exists)
        return {
          alreadyApplied: true,
          writes: 0,
          venue: event.venue,
          date: event.platform.details.dateLabel,
        };
      assert(
        event.phase === 'REGISTRATION' &&
          event.platform.currentRound === 0 &&
          event.platform.rulesLockedAt === null,
        'The event must still be in registration.',
      );
      assert(
        sheets.empty && awards.empty,
        'Existing scores must be reviewed before changing the judging scale.',
      );
      const details = {
        ...event.platform.details,
        schedule: plan.schedule,
        registrationUrl: plan.registrationUrl,
        logistics: plan.logistics,
        organization: plan.organization,
      };
      if (apply) {
        const now = Date.now();
        tx.create(marker, {
          previousVenue: event.venue,
          previousDetails: event.platform.details,
          appliedAt: now,
          actorUid: owner.uid,
        });
        tx.update(root, { 'platform.details': details });
        tx.create(root.collection('adminAudit').doc('september-2026-website-feedback'), {
          id: 'september-2026-website-feedback',
          actorUid: owner.uid,
          action: 'publishWebsiteFeedback',
          detail:
            'Published registration form, chronological schedule, attendee logistics and Emergent link. Confirmed no existing judging sheets or results before the 0–5 score release. Funding rules, planned window times and live state preserved.',
          createdAt: now,
        });
      }
      return {
        mode: apply ? 'applied' : 'read-only preflight',
        judgingSheets: 0,
        awardResults: 0,
        writes: apply ? 3 : 0,
        project,
        phase: event.phase,
        venue: event.venue,
        date: details.dateLabel,
        scheduleItems: details.schedule.length,
        fundingWindows: details.timing?.rounds.map((item) =>
          EventSchedule.label(item, details.timeZone),
        ),
      };
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await db.terminate();
    await deleteApp(app);
  }
}
main().catch(() => {
  console.error(
    'Feedback publication stopped. Check the existing organizer login, configured project and registration phase. No credential details were printed.',
  );
  process.exitCode = 1;
});
