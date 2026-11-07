/** Set the suggested first round to 1 p.m.; never open or close a live round. */
import { build } from 'esbuild';
import { Firestore } from 'firebase-admin/firestore';
import { OAuth2Client } from 'google-auth-library';
import { cliCredential } from './bootstrap-firebase.mjs';
const { credential } = await cliCredential();
const oauth = new OAuth2Client();
oauth.refreshHandler = async () => {
  const token = await credential.getAccessToken();
  return { access_token: token.access_token, expiry_date: Date.now() + token.expires_in * 1000 };
};
const db = new Firestore({ projectId: 'robinhacks-2026-ajs', authClient: oauth, preferRest: true });
const bundle = await build({
  entryPoints: ['packages/core/src/event-schedule.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
const { EventSchedule, defaultEventDetails } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
);
try {
  const result = await db.runTransaction(async (tx) => {
    const root = db.doc('events/robinhacks-2026');
    const snapshot = await tx.get(root);
    const event = snapshot.data();
    if (!event?.platform?.details?.timing) throw new Error('Event timing missing.');
    const timing = structuredClone(event.platform.details.timing);
    timing.rounds[0] = defaultEventDetails().timing.rounds[0];
    EventSchedule.validate(timing);
    const schedule = event.platform.details.schedule.filter((row) => row.window !== 'round1');
    const lunch = schedule.findIndex((row) => /lunch/i.test(row.title));
    schedule.splice(
      lunch >= 0 ? lunch + 1 : 1,
      0,
      defaultEventDetails().schedule.find((row) => row.window === 'round1'),
    );
    for (const row of schedule) {
      if (row.title === 'Building' && row.time === 'Sat · 1–6 p.m.') row.time = 'Sat · 1:30–6 p.m.';
    }
    if (process.argv.includes('--apply')) {
      tx.update(root, {
        'platform.details.timing': timing,
        'platform.details.schedule': schedule,
        phaseVersion: event.phaseVersion + 1,
      });
    }
    return {
      applied: process.argv.includes('--apply'),
      firstRound: EventSchedule.label(timing.rounds[0], event.platform.details.timeZone),
    };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await db.terminate();
}
