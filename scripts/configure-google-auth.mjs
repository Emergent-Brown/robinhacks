#!/usr/bin/env node
/** Firebase CLI enables providers but ignores false flags; explicitly disable local sign-in. */
import { readFile } from 'node:fs/promises';
import { cliCredential } from './bootstrap-firebase.mjs';
const args = process.argv.slice(2);
const at = args.indexOf('--project');
const project = at >= 0 ? args[at + 1] : '';
const apply = args.includes('--apply');
try {
  const configured = JSON.parse(await readFile(new URL('../.firebaserc', import.meta.url), 'utf8'));
  if (
    !project ||
    project !== configured.projects?.default ||
    args.some((arg, index) => !['--project', '--apply'].includes(arg) && index !== at + 1)
  )
    throw new Error('Supply --project matching .firebaserc, and optionally --apply.');
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIREBASE_TOKEN)
    throw new Error('Unset emulator hosts and FIREBASE_TOKEN. Use the verified CLI login.');
  const { credential } = await cliCredential();
  const token = await credential.getAccessToken();
  const headers = {
    Authorization: `Bearer ${token.access_token}`,
    'Content-Type': 'application/json',
  };
  const url = `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`;
  async function request(target, options = {}) {
    const response = await fetch(target, {
      headers,
      ...options,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Auth configuration returned HTTP ${response.status}.`);
    return response.json();
  }
  const providers = await request(
    `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/defaultSupportedIdpConfigs`,
  );
  const enabled = (providers.defaultSupportedIdpConfigs || [])
    .filter((provider) => provider.enabled)
    .map((provider) => provider.name.split('/').at(-1));
  if (!enabled.includes('google.com') || enabled.some((provider) => provider !== 'google.com'))
    throw new Error(
      'Enable Google and review other federated providers in Firebase Authentication before continuing.',
    );
  if (apply)
    await request(
      `${url}?updateMask=signIn.email.enabled,signIn.anonymous.enabled,signIn.phoneNumber.enabled`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          name: `projects/${project}/config`,
          signIn: {
            email: { enabled: false },
            anonymous: { enabled: false },
            phoneNumber: { enabled: false },
          },
        }),
      },
    );
  const config = await request(url);
  const localProviders = Object.fromEntries(
    ['email', 'anonymous', 'phoneNumber'].map((name) => [
      name,
      config.signIn?.[name]?.enabled === true,
    ]),
  );
  if (apply && Object.values(localProviders).some(Boolean))
    throw new Error('A local sign-in provider remains enabled.');
  console.log(
    JSON.stringify(
      {
        project,
        mode: apply ? 'apply' : 'preflight',
        enabledFederatedProviders: enabled,
        localProviders,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    error.constructor === Error
      ? error.message
      : 'Auth configuration failed. No credentials or service response bodies were logged.',
  );
  process.exitCode = 1;
}
