import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { firebaseKeys } from './vercel-config.mjs';
import { addWebAppMetadata } from './web-app-meta.mjs';
import { checkHostedStorage } from './check-hosted-storage.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const missing = firebaseKeys.filter(key => !process.env[key]?.trim());
if (missing.length) throw new Error(`Missing public Firebase settings: ${missing.join(', ')}`);
if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PROJECT_ID !== process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID) {
  throw new Error('Web and API Firebase project IDs must match.');
}

const output = path.join(root, 'dist/web');
await checkHostedStorage();
function run(args, cwd) {
  const result = spawnSync('pnpm', args, {
    cwd,
    env: { ...process.env, CI: '1', EXPO_NO_DOTENV: '1', EXPO_PUBLIC_DOMAIN: '' },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
run(['exec', 'expo', 'export', '--platform', 'web', '--max-workers', '2', '--output-dir', output], path.join(root, 'artifacts/round-house'));
await access(path.join(output, 'index.html'));
await addWebAppMetadata(output);
run(['--filter', '@workspace/api-server', 'build'], root);
console.log('Web and API builds are ready for a single hosted service.');
