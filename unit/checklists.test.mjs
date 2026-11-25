// pickChecklist — an asset must never get an unrelated checklist (E2E pass 2026-11-25: a fire
// extinguisher was handed the CMS's "Smartphone" checklist because the code fell back to entry 0).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pickChecklist;
let workDir;
before(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'equipcert-unit-'));
  const outfile = join(workDir, 'checklists.mjs');
  buildSync({ entryPoints: ['src/lib/checklists.ts'], bundle: true, format: 'esm', platform: 'neutral', logLevel: 'warning', outfile });
  ({ pickChecklist } = await import(pathToFileURL(outfile).href));
});
after(() => rmSync(workDir, { recursive: true, force: true }));

const cms = [
  { fields: { equipmentType: { fields: { name: 'Smartphone' } }, questions: [{ text: 'Is the screen ok?' }] } },
  { fields: { equipmentType: { fields: { name: 'Caterpillar X500' } }, questions: { questions: [{ question: 'Hydraulic fluid normal?' }] } } },
];

test('a CMS checklist for the type wins', () => {
  const r = pickChecklist(cms, ['Caterpillar X500']);
  assert.equal(r.source, 'cms');
  assert.deepEqual(r.questions, ['Hydraulic fluid normal?']);
});

test('a fire extinguisher with no CMS checklist gets the built-in one, never the first CMS entry', () => {
  const r = pickChecklist(cms, ['Fire Extinguisher', 'Stair extinguisher']);
  assert.equal(r.source, 'built-in');
  assert.ok(r.questions.length >= 5);
  assert.ok(!r.questions.some((q) => /screen|camera|battery/i.test(q)));
  assert.ok(r.questions.some((q) => /pressure gauge/i.test(q)));
});

test('unknown equipment gets the general checklist', () => {
  const r = pickChecklist(cms, ['Forklift']);
  assert.equal(r.source, 'general');
  assert.ok(r.questions.length > 0);
});

test('an empty or missing term matches nothing (it used to match every entry)', () => {
  assert.equal(pickChecklist(cms, ['', null, undefined]).source, 'general');
  assert.equal(pickChecklist([], []).source, 'general');
});

test('the name is tried when the type has no match', () => {
  const r = pickChecklist(cms, ['Excavator', 'caterpillar x500']);
  assert.equal(r.source, 'cms');
});

test('a CMS entry with no usable questions falls through instead of yielding an empty checklist', () => {
  const r = pickChecklist([{ fields: { equipmentType: { fields: { name: 'Fire Extinguisher' } }, questions: [] } }], ['Fire Extinguisher']);
  assert.equal(r.source, 'built-in');
});

// Fresh review 2026-11-25: substring matching in both directions, name before type.
const cms2 = [
  { fields: { equipmentType: { fields: { name: 'Car' } }, questions: ['Tyres inflated?'] } },
  { fields: { equipmentType: { fields: { name: 'Hose' } }, questions: ['Hose cracked?'] } },
];

test('the type wins over a word in the name', () => {
  const r = pickChecklist(cms2, ['Fire Extinguisher', 'Extinguisher - car park L2']);
  assert.equal(r.source, 'built-in');
  assert.ok(r.questions.some((q) => /pressure gauge/i.test(q)));
  assert.equal(pickChecklist(cms2, ['Fire Extinguisher', 'Extinguisher hose reel']).source, 'built-in');
});

test('matching is by whole words, not substrings', () => {
  assert.equal(pickChecklist(cms2, ['Carbon dioxide unit']).source, 'general');
  assert.equal(pickChecklist(cms2, ['Cart']).source, 'general');
  assert.equal(pickChecklist(cms2, ['car']).source, 'cms');
});
