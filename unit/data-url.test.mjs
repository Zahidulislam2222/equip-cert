// dataUrlToBlob — the signature upload path that must not depend on fetch() (production CSP).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let mod;
let workDir;
before(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'equipcert-unit-'));
  const outfile = join(workDir, 'data-url.mjs');
  buildSync({ entryPoints: ['src/lib/data-url.ts'], bundle: true, format: 'esm', platform: 'neutral', logLevel: 'warning', outfile });
  mod = await import(pathToFileURL(outfile).href);
});
after(() => rmSync(workDir, { recursive: true, force: true }));

// The 8-byte PNG signature, base64.
const PNG_HEAD = 'iVBORw0KGgo=';

test('decodes a base64 PNG data URL into the exact bytes and type', async () => {
  const blob = mod.dataUrlToBlob(`data:image/png;base64,${PNG_HEAD}`);
  assert.equal(blob.type, 'image/png');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...bytes], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});

test('refuses anything that is not a base64 data URL', () => {
  for (const bad of ['https://example.invalid/x.png', 'data:image/png,raw', 'data:image/png;base64,***', '']) {
    assert.throws(() => mod.dataUrlToBlob(bad), /Not a base64 data URL/, bad);
  }
});
