import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { deploymentConfig } from './vercel-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.vercel/output');
const config = deploymentConfig(process.env);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
// Web requests use the same origin and the /api proxy. Never embed a stale
// Codespace domain. Disable automatic .env loading; hosting supplies the env.
const result = spawnSync('pnpm', ['exec', 'expo', 'export', '--platform', 'web', '--output-dir', path.join(output, 'static')], {
  cwd: path.join(root, 'artifacts/round-house'),
  env: { ...process.env, CI: '1', EXPO_NO_DOTENV: '1', EXPO_PUBLIC_DOMAIN: '' },
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
await access(path.join(output, 'static/index.html'));
await writeFile(path.join(output, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
console.log('Vercel web artifact ready. Backend readiness and sign-in still require a deployed smoke test.');
