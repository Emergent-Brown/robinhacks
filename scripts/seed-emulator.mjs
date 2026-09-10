import { build } from 'esbuild';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
// This command deliberately cannot seed a remote Firebase project.
for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  const expected = key === 'FIRESTORE_EMULATOR_HOST' ? '127.0.0.1:8080' : '127.0.0.1:9099';
  if (process.env[key] && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key]))
    throw new Error(`${key} must be localhost.`);
  process.env[key] ||= expected;
}
const bundled = await build({
  entryPoints: ['packages/application/src/fixtures.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { createDemoDocuments, DEMO_EVENT_ID, DEMO_USERS } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64')
);
const app = initializeApp({ projectId: 'demo-robinhacks' });
const db = getFirestore(app),
  auth = getAuth(app);
const documents = createDemoDocuments(process.argv.includes('--seed') ? 'seed' : 'trading');
for (const user of Object.values(DEMO_USERS)) {
  try {
    await auth.createUser({ ...user, password: 'hackathon-demo-2026', emailVerified: true });
  } catch (error) {
    if (error.code !== 'auth/uid-already-exists' && error.code !== 'auth/email-already-exists')
      throw error;
  }
}
await db.recursiveDelete(db.doc(`events/${DEMO_EVENT_ID}`));
const entries = Object.entries(documents);
for (let start = 0; start < entries.length; start += 400) {
  const batch = db.batch();
  for (const [path, value] of entries.slice(start, start + 400)) batch.set(db.doc(path), value);
  await batch.commit();
}
console.log(
  `Seeded ${entries.length} documents in LOCAL demo-robinhacks.\nCaptain: alex@example.test\nOrganizer: organizer@example.test\nMember: sam@example.test\nPassword for these emulator-only users: hackathon-demo-2026`,
);
