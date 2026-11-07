/** Publish dinner at 7 p.m. and Round 2 at 7:30 p.m., without changing live round state. */
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
    if (event.platform.currentRound >= 2)
      throw new Error(
        'Round 2 has already opened; review the requested next round before rescheduling.',
      );
    const details = event.platform.details;
    const plan = defaultEventDetails();
    const timing = structuredClone(details.timing);
    timing.rounds[1] = plan.timing.rounds[1];
    EventSchedule.validate(timing);
    const schedule = details.schedule.filter(
      (row) =>
        row.window !== 'round2' && !(row.title === 'Building' && row.time === 'Sat · 8–9 p.m.'),
    );
    let dinner = schedule.findIndex((row) => /dinner/i.test(row.title));
    if (dinner < 0) {
      const building = schedule.findIndex((row) => row.time === 'Sat · 9:30 p.m.–midnight');
      dinner = building >= 0 ? building : schedule.length;
      schedule.splice(dinner, 0, { time: 'Sat · 7 p.m.', title: 'Dinner', description: '' });
    } else schedule[dinner] = { ...schedule[dinner], time: 'Sat · 7 p.m.' };
    schedule.splice(
      dinner + 1,
      0,
      plan.schedule.find((row) => row.window === 'round2'),
    );
    for (const row of schedule) {
      if (row.title === 'Building' && row.time === 'Sat · 9:30 p.m.–midnight')
        row.time = 'Sat · 8 p.m.–midnight';
    }
    if (process.argv.includes('--apply'))
      tx.update(root, {
        'platform.details.timing': timing,
        'platform.details.schedule': schedule,
        phaseVersion: event.phaseVersion + 1,
      });
    return {
      applied: process.argv.includes('--apply'),
      currentRound: event.platform.currentRound,
      dinner: schedule[dinner],
      nextRound: EventSchedule.label(timing.rounds[1], details.timeZone),
    };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await db.terminate();
}
