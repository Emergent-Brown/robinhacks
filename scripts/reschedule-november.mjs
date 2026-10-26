/** Move the planned event to November 7 without changing live funding or participant records. */
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
    const marker = root.collection('migrations').doc('november-7-2026-luma-date-correction');
    const [snapshot, prior] = await Promise.all([tx.get(root), tx.get(marker)]);
    const event = snapshot.data();
    if (!event?.platform?.details) throw new Error('Event details missing.');
    if (prior.exists) return { alreadyApplied: true, date: event.platform.details.dateLabel };
    if (event.phase !== 'REGISTRATION' || event.platform.currentRound !== 0)
      throw new Error('Event has started; rescheduling needs review.');
    const old = event.platform.details,
      plan = defaultEventDetails();
    const timeZone = old.timeZone || 'America/New_York';
    const timing = structuredClone(old.timing || plan.timing);
    const oldDate = EventSchedule.inputValue(timing.rounds[0].startsAt, timeZone).slice(0, 10);
    const targetDate = EventSchedule.inputValue(
      plan.timing.rounds[0].startsAt,
      plan.timeZone,
    ).slice(0, 10);
    const days =
      (Date.parse(targetDate + 'T00:00:00Z') - Date.parse(oldDate + 'T00:00:00Z')) / 86400000;
    const shift = (stamp) => {
      const civil = EventSchedule.inputValue(stamp, timeZone);
      const date = new Date(Date.parse(civil.slice(0, 10) + 'T00:00:00Z') + days * 86400000)
        .toISOString()
        .slice(0, 10);
      return EventSchedule.parseInput(date + civil.slice(10), timeZone);
    };
    for (const window of [...timing.rounds, timing.submissions, timing.ballot]) {
      window.startsAt = shift(window.startsAt);
      window.closesAt = shift(window.closesAt);
    }
    EventSchedule.validate(timing);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const fullDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const shiftDays = (text) =>
      text.replace(
        /\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/g,
        (name) => {
          const names = fullDays.includes(name) ? fullDays : dayNames;
          return names[(names.indexOf(name) + (days % 7) + 7) % 7];
        },
      );
    const details = {
      ...old,
      dateLabel: plan.dateLabel,
      registrationUrl: plan.registrationUrl,
      timing,
      schedule: old.schedule.map((row) => ({ ...row, time: shiftDays(row.time) })),
      ...(old.logistics
        ? {
            logistics: {
              ...old.logistics,
              overnight: shiftDays(old.logistics.overnight),
            },
          }
        : {}),
    };
    if (process.argv.includes('--apply')) {
      tx.create(marker, { previousDetails: old, appliedAt: Date.now() });
      tx.update(root, { 'platform.details': details, phaseVersion: event.phaseVersion + 1 });
    }
    return {
      mode: process.argv.includes('--apply') ? 'applied' : 'preview',
      date: details.dateLabel,
      registrationUrl: details.registrationUrl,
      rounds: timing.rounds.map((w) => EventSchedule.label(w, timeZone)),
    };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await db.terminate();
}
