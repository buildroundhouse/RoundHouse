import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

// Expo's single-page export bypasses app/+html.tsx. Apply this after export
// so the hosted app uses the existing black Roundhouse home-screen artwork.
export async function addWebAppMetadata(output) {
  const manifest = JSON.parse(await readFile(path.join(output, 'manifest.webmanifest'), 'utf8'));
  for (const asset of ['apple-touch-icon.png', ...manifest.icons.map(icon => icon.src.replace(/^\//, ''))]) {
    await access(path.join(output, asset));
  }
  const filename = path.join(output, 'index.html');
  let html = await readFile(filename, 'utf8');
  if (!html.includes('</head>')) throw new Error('Exported HTML is missing </head>.');
  const tags = [
    ['rel="manifest"', '<link rel="manifest" href="/manifest.webmanifest" />'],
    ['rel="apple-touch-icon"', '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />'],
    ['name="apple-mobile-web-app-capable"', '<meta name="apple-mobile-web-app-capable" content="yes" />'],
    ['name="apple-mobile-web-app-title"', '<meta name="apple-mobile-web-app-title" content="Roundhouse" />'],
    ['name="apple-mobile-web-app-status-bar-style"', '<meta name="apple-mobile-web-app-status-bar-style" content="default" />'],
    ['name="mobile-web-app-capable"', '<meta name="mobile-web-app-capable" content="yes" />'],
    ['name="theme-color"', '<meta name="theme-color" content="#000000" />'],
  ];
  const missing = tags.filter(([marker]) => !html.includes(marker)).map(([, tag]) => tag);
  html = html.replace('</head>', `${missing.join('\n')}\n</head>`);
  await writeFile(filename, html);
}
