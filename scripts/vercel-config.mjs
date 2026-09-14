export const firebaseKeys = [
  'EXPO_PUBLIC_FIREBASE_API_KEY',
  'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_FIREBASE_APP_ID',
];

export function deploymentConfig(env) {
  const missing = [...firebaseKeys, 'ROUNDHOUSE_API_ORIGIN'].filter(key => !env[key]?.trim());
  if (missing.length) throw new Error(`Missing deployment settings: ${missing.join(', ')}`);
  const api = new URL(env.ROUNDHOUSE_API_ORIGIN);
  if (api.protocol !== 'https:' || api.username || api.password || api.search || api.hash || api.pathname !== '/') {
    throw new Error('ROUNDHOUSE_API_ORIGIN must be an HTTPS origin without credentials, paths or query strings.');
  }
  if (/localhost|127\.0\.0\.1|\[::1\]|\.local$|\.exp\.direct$|\.app\.github\.dev$|\.ngrok(?:-free)?\.(?:app|io)$/.test(api.hostname)) {
    throw new Error('ROUNDHOUSE_API_ORIGIN must point to permanent hosting, not a development tunnel.');
  }
  if ([env.VERCEL_URL, env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).includes(api.hostname)) {
    throw new Error('ROUNDHOUSE_API_ORIGIN points back to this frontend and would create a proxy loop.');
  }
  return {
    version: 3,
    routes: [
      { src: '^/api(?:/(.*))?$', dest: `${api.origin}/api/$1`, headers: { 'Cache-Control': 'no-store' } },
      { handle: 'filesystem' },
      // Missing bundles must remain 404s rather than returning HTML as JavaScript.
      { src: '^/(?:_expo|assets)/.*$', status: 404 },
      { src: '^/.*$', dest: '/index.html', headers: { 'Cache-Control': 'no-cache' } },
    ],
  };
}
