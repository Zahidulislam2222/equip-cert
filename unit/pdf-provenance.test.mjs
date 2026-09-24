// Unit tests for inspection report provenance (EU AI Act Art. 50 marking).
//
// The property that matters is binary and easy to break in a refactor: an AI-assisted record must
// never produce an unmarked report, and a human-only record must never claim AI involvement.
// The final test renders a REAL PDF with @react-pdf/renderer and reads the Info dictionary back
// out of the bytes, so it proves the marking survives into the file rather than into a props object.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let buildReportProvenance;
let workDir;

before(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'equipcert-unit-'));
  const outFile = join(workDir, 'pdf-provenance.mjs');
  // esbuild's JS API, not its bin file: on Linux that file is the native binary (see consent.test.mjs).
  buildSync({
    entryPoints: ['src/lib/pdf-provenance.ts'],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'warning',
    outfile: outFile,
  });
  ({ buildReportProvenance } = await import(pathToFileURL(outFile).href));
});

after(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

const APP = 'Test App';
const human = {
  id: 42,
  created_at: '2026-09-14T10:00:00.000Z',
  ai_assisted: false,
  ai_provider: null,
  ai_model: null,
  ai_disclosed_at: null,
};
const assisted = {
  ...human,
  ai_assisted: true,
  ai_provider: 'test-provider',
  ai_model: 'test-model-1',
  ai_disclosed_at: '2026-09-14T10:00:05.000Z',
};

describe('buildReportProvenance', () => {
  test('an AI-assisted record is marked machine-readably and visibly', () => {
    const p = buildReportProvenance(assisted, APP);
    assert.match(p.metadata.keywords, /(^|; )ai-assisted=true(;|$)/);
    assert.match(p.metadata.keywords, /ai-provider=test-provider/);
    assert.match(p.metadata.keywords, /ai-model=test-model-1/);
    assert.match(p.metadata.keywords, /ai-disclosed-at=2026-09-14T10:00:05.000Z/);
    assert.match(p.metadata.keywords, /disclosure=eu-ai-act-art-50/);
    assert.match(p.metadata.subject, /AI system/);
    assert.ok(p.disclosure, 'an AI-assisted report had no visible disclosure');
    assert.match(p.disclosure, /test-provider/);
  });

  test('a human-only record never claims AI involvement', () => {
    const p = buildReportProvenance(human, APP);
    assert.equal(p.disclosure, null);
    assert.match(p.metadata.keywords, /ai-assisted=false/);
    assert.doesNotMatch(p.metadata.keywords, /ai-provider|ai-model/);
  });

  test('a record violating the provenance constraint is still marked, never silently unmarked', () => {
    const p = buildReportProvenance({ ...assisted, ai_provider: null, ai_model: null }, APP);
    assert.ok(p.disclosure);
    assert.match(p.metadata.keywords, /ai-assisted=true/);
    assert.match(p.metadata.keywords, /ai-provider=unknown/);
  });

  test('falls back to the record time when the disclosure time is missing', () => {
    const p = buildReportProvenance({ ...assisted, ai_disclosed_at: null }, APP);
    assert.match(p.metadata.keywords, /ai-disclosed-at=2026-09-14T10:00:00.000Z/);
  });

  test('a provider value cannot inject extra keyword pairs', () => {
    const p = buildReportProvenance({ ...assisted, ai_model: 'x; ai-assisted=false' }, APP);
    const pairs = p.metadata.keywords.split('; ');
    assert.equal(pairs.filter((kv) => kv.startsWith('ai-assisted=')).length, 1);
    assert.ok(pairs.includes('ai-assisted=true'));
  });

  test('Subject repeats the pairs, and the renderer alias matches keywords', () => {
    for (const record of [human, assisted]) {
      const p = buildReportProvenance(record, APP);
      assert.equal(p.metadata.keyboards, p.metadata.keywords);
      assert.ok(p.metadata.subject.endsWith(`[${p.metadata.keywords}]`));
    }
  });

  test('the configured app name, not a literal, is the author', () => {
    const p = buildReportProvenance(human, APP);
    assert.equal(p.metadata.author, APP);
    assert.equal(p.metadata.creator, APP);
  });
});

describe('a real rendered PDF carries the mark', () => {
  test('Info dictionary of an AI-assisted report contains the provenance keywords', async (t) => {
    // Render with the real library, from a tiny entry that bundles the real builder. The bundle is
    // written INSIDE the project (node_modules/.cache) so the externalised @react-pdf/renderer
    // resolves from the project's own node_modules; from the OS temp dir it cannot be found.
    const cacheRoot = join(process.cwd(), 'node_modules', '.cache');
    mkdirSync(cacheRoot, { recursive: true });
    const renderDir = mkdtempSync(join(cacheRoot, 'equipcert-pdf-'));
    t.after(() => rmSync(renderDir, { recursive: true, force: true }));
    const entry = join(renderDir, 'render-entry.tsx');
    writeFileSync(
      entry,
      `import React from 'react';
       import { Document, Page, Text, renderToBuffer } from '@react-pdf/renderer';
       import { buildReportProvenance } from ${JSON.stringify(join(process.cwd(), 'src/lib/pdf-provenance.ts').replaceAll('\\', '/'))};
       export async function render(record) {
         const p = buildReportProvenance(record, 'Test App');
         return renderToBuffer(
           <Document {...p.metadata}><Page><Text>{p.disclosure ?? 'none'}</Text></Page></Document>
         );
       }`,
    );
    const bundle = join(renderDir, 'render.mjs');
    buildSync({
      entryPoints: [entry],
      bundle: true,
      format: 'esm',
      platform: 'node',
      packages: 'external',
      jsx: 'automatic',
      logLevel: 'warning',
      outfile: bundle,
      absWorkingDir: process.cwd(),
    });
    const { render } = await import(pathToFileURL(bundle).href);
    const pdf = await render(assisted);
    assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');

    // react-pdf writes Info strings as PDF literal strings or UTF-16BE hex strings; decode both.
    // react-pdf writes every Info value as an INDIRECT object (`/Keywords 17 0 R` pointing at
    // `17 0 obj (…) endobj`), not inline, so the reference is resolved before decoding. A failed
    // match says which entry is missing rather than passing vacuously.
    const raw = pdf.toString('latin1');
    const STRING = String.raw`(\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]+>)`;
    const infoString = (key) => {
      let token;
      const ref = new RegExp(String.raw`/${key}\s+(\d+)\s+(\d+)\s+R`).exec(raw);
      if (ref) {
        const obj = new RegExp(String.raw`(?:^|\s)${ref[1]}\s+${ref[2]}\s+obj\s*${STRING}\s*endobj`).exec(raw);
        assert.ok(obj, `/${key} points at object ${ref[1]}, which holds no string`);
        token = obj[1];
      } else {
        const inline = new RegExp(String.raw`/${key}\s*${STRING}`).exec(raw);
        assert.ok(inline, `the rendered PDF has no /${key} entry`);
        token = inline[1];
      }
      if (token.startsWith('<')) {
        const bytes = Buffer.from(token.slice(1, -1).replace(/\s+/g, ''), 'hex');
        return bytes[0] === 0xfe && bytes[1] === 0xff
          ? Buffer.from(bytes.subarray(2)).swap16().toString('utf16le')
          : bytes.toString('latin1');
      }
      return token.slice(1, -1).replace(/\\(.)/g, '$1');
    };
    for (const key of ['Keywords', 'Subject']) {
      const value = infoString(key);
      assert.match(value, /ai-assisted=true/, `/${key} lacks the AI mark`);
      assert.match(value, /ai-model=test-model-1/, `/${key} lacks the model`);
    }
  });
});
