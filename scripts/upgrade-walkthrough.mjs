/** One-time, non-destructive registration upgrade. Dry-run unless --apply is supplied. */
import { mkdir, writeFile } from 'node:fs/promises';
import { Firestore } from 'firebase-admin/firestore';
import { OAuth2Client } from 'google-auth-library';
import { cliCredential } from './bootstrap-firebase.mjs';
const projectId = 'robinhacks-2026-ajs';
const { credential } = await cliCredential();
const oauth = new OAuth2Client();
oauth.refreshHandler = async () => {
  const token = await credential.getAccessToken();
  return { access_token: token.access_token, expiry_date: Date.now() + token.expires_in * 1000 };
};
const db = new Firestore({ projectId, authClient: oauth, preferRest: true });
try {
  const root = db.doc('events/robinhacks-2026');
  const before = await root.get();
  const event = before.data();
  if (!event || event.phase !== 'REGISTRATION' || event.platform.rulesLockedAt !== null)
    throw new Error('Upgrade requires registration with unlocked rules. No changes made.');
  if (
    event.platform.funding.investorPoolMinor !== 0 ||
    event.platform.funding.builderPrizesMinor.some((n) => n !== 0) ||
    event.platform.funding.communityPrizeMinor !== 0
  )
    throw new Error('Prize amounts have been set. Review the intended split before migrating.');
  const members = await root.collection('members').get();
  if (members.docs.some((d) => d.data().role === 'trader'))
    throw new Error('A retired role remains. Review its conversion before upgrading.');
  if (!process.argv.includes('--apply')) {
    console.log(
      'Ready: registration, unlocked rules, no announced prize amounts or retired roles. Run with --apply to update event metadata only.',
    );
  } else {
    await mkdir('backups', { recursive: true });
    await writeFile(
      `backups/walkthrough-event-${Date.now()}.json`,
      JSON.stringify(event, null, 2),
      { mode: 0o600 },
    );
    await db.runTransaction(async (tx) => {
      const latest = await tx.get(root);
      if (!latest.updateTime.isEqual(before.updateTime))
        throw new Error('Event changed. Re-run the upgrade against the new state.');
      tx.update(root, {
        'platform.funding.prizeModel': 'shared-grand-prize',
        'platform.autoApproveParticipants': event.platform.autoApproveParticipants ?? false,
        'platform.details.theme': '',
        'platform.details.schedule': event.platform.details.schedule.filter(
          (item) => item.window !== 'ballot',
        ),
        'platform.ballotOpen': false,
        'platform.ballotClosesAt': null,
        phaseVersion: event.phaseVersion + 1,
      });
    });
    console.log(
      'Updated event metadata. Teams, members, projects, messages, and poster counts were preserved. Automatic signup approval remains at its existing setting (off by default).',
    );
  }
} finally {
  await db.terminate();
}
