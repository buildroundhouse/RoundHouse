import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { addWebAppMetadata } from './web-app-meta.mjs';

test('hosted export links the shipped black icons and standalone manifest', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'roundhouse-icon-'));
  try {
    await cp(new URL('../artifacts/round-house/public/', import.meta.url), output, { recursive: true });
    const original = '<html><head><title>Roundhouse</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
    await writeFile(path.join(output, 'index.html'), original);
    await addWebAppMetadata(output);
    await addWebAppMetadata(output);
    const html = await readFile(path.join(output, 'index.html'), 'utf8');
    assert.equal(html.match(/rel="manifest"/g).length, 1);
    assert.equal(html.match(/rel="apple-touch-icon"/g).length, 1);
    assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
    assert.match(html, /name="apple-mobile-web-app-title" content="Roundhouse"/);
    assert.ok(html.endsWith(original.slice(original.indexOf('</head>'))));
    const manifest = JSON.parse(await readFile(path.join(output, 'manifest.webmanifest'), 'utf8'));
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, '/');
    assert.equal(manifest.background_color, '#000000');
    for (const [file, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
      const bytes = await readFile(path.join(output, file));
      assert.equal(bytes.readUInt32BE(16), size);
      assert.equal(bytes.readUInt32BE(20), size);
    }
    await rm(path.join(output, 'apple-touch-icon.png'));
    await assert.rejects(addWebAppMetadata(output), /ENOENT/);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
