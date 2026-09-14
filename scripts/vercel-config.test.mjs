import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deploymentConfig, firebaseKeys } from './vercel-config.mjs';

const env = { ...Object.fromEntries(firebaseKeys.map(key => [key, 'test-only'])), ROUNDHOUSE_API_ORIGIN: 'https://api.example.com' };
test('requires API and Firebase configuration instead of deploying a nonfunctional login', () => {
  assert.throws(() => deploymentConfig({}), /Missing deployment settings/);
});
test('rejects tunnels, insecure URLs, embedded credentials and proxy loops', () => {
  for (const origin of ['http://api.example.com', 'https://user:secret@api.example.com', 'https://api.example.com/api', 'https://test.exp.direct', 'https://zany-3001.app.github.dev', 'https://localhost', 'https://x.ngrok-free.app']) {
    assert.throws(() => deploymentConfig({ ...env, ROUNDHOUSE_API_ORIGIN: origin }));
  }
  assert.throws(() => deploymentConfig({ ...env, VERCEL_URL: 'api.example.com' }), /proxy loop/);
});
test('API routing precedes static files and deep-link fallback', () => {
  const { routes } = deploymentConfig(env);
  assert.equal('/api/profile'.replace(new RegExp(routes[0].src), routes[0].dest), 'https://api.example.com/api/profile');
  assert.equal(routes[0].headers['Cache-Control'], 'no-store');
  assert.equal(routes[1].handle, 'filesystem');
  assert.equal(routes[2].status, 404);
  assert.equal(routes[3].dest, '/index.html');
});
