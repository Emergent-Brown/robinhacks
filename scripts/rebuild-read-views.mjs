#!/usr/bin/env node
/** Rebuild server-only collection pages after deployment or a direct Firestore data repair.
 * Defaults to read-only inspection. --apply changes derived pages only; --verify compares
 * pages with source records in a consistent read-only transaction. Never prints participant data.
 */
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { build } from 'esbuild';
import { Firestore } from 'firebase-admin/firestore';
import { OAuth2Client } from 'google-auth-library';
import { cliCredential } from './bootstrap-firebase.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'robinhacks-2026-ajs';
const EVENT = 'robinhacks-2026';
async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--apply', '--verify'].includes(arg)))
    throw new Error('Use no arguments, --verify, or --apply --verify.');
  if (
    process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST ||
    process.env.FIREBASE_TOKEN
  )
    throw new Error('Unset emulator and token overrides for this production-only operation.');
  const config = JSON.parse(await readFile(resolve(ROOT, '.firebaserc'), 'utf8'));
  if (config.projects?.default !== PROJECT) throw new Error('Unexpected default Firebase project.');
  await mkdir(resolve(ROOT, 'output'), { recursive: true });
  const bundle = resolve(ROOT, 'output/read-view-operations.mjs');
  await build({
    stdin: {
      contents:
        "export { FirestoreRepository } from './apps/functions/src/firestore-repository'; export { PROJECTED_COLLECTIONS } from './apps/functions/src/read-projections';",
      resolveDir: ROOT,
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    outfile: bundle,
  });
  const { FirestoreRepository, PROJECTED_COLLECTIONS } = await import(pathToFileURL(bundle).href);
  const { credential } = await cliCredential();
  const oauth = new OAuth2Client();
  oauth.refreshHandler = async () => {
    const token = await credential.getAccessToken();
    return { access_token: token.access_token, expiry_date: Date.now() + token.expires_in * 1000 };
  };
  const db = new Firestore({ projectId: PROJECT, authClient: oauth, preferRest: true });
  try {
    if (!(await db.doc(`events/${EVENT}`).get()).exists) throw new Error('Event does not exist.');
    const repository = new FirestoreRepository(db);
    if (args.includes('--apply')) await repository.rebuildReadViews(EVENT);
    const report = await repository.read(async (tx) => {
      const rows = [];
      for (const [name, limit] of Object.entries(PROJECTED_COLLECTIONS)) {
        const path = `events/${EVENT}/${name}`;
        // A limit above the page's safety bound deliberately selects authoritative source reads.
        const source = await tx.list(path, limit + 1);
        const manifest = await tx.get(`events/${EVENT}/readViews/${name}`);
        let matches;
        if (args.includes('--verify')) {
          const projected = await tx.list(path, limit);
          matches =
            !!manifest &&
            manifest.schema === 1 &&
            manifest.count === source.length &&
            isDeepStrictEqual(projected, source.slice(0, limit));
          // Explicitly check all pages; a fallback should not disguise an incomplete backfill.
          if (matches) {
            const values = [];
            for (let i = 0; i < manifest.chunks; i++) {
              const page = await tx.get(`events/${EVENT}/readViews/${name}/chunks/${i}`);
              if (!Array.isArray(page?.rows)) matches = false;
              else values.push(...page.rows.map((row) => row.value));
            }
            matches = matches && isDeepStrictEqual(values, source);
          }
        }
        rows.push({
          collection: name,
          sourceCount: source.length,
          pages: manifest?.chunks ?? null,
          matches,
        });
      }
      return rows;
    });
    console.log(
      JSON.stringify(
        { project: PROJECT, event: EVENT, applied: args.includes('--apply'), collections: report },
        null,
        2,
      ),
    );
    if (report.some((row) => row.matches === false)) process.exitCode = 1;
  } finally {
    await db.terminate();
  }
}
main().catch(() => {
  console.error(
    'Read-view operation failed. Check CLI login, default project, and Firestore access. Error details withheld to protect credentials and participant data.',
  );
  process.exitCode = 1;
});
