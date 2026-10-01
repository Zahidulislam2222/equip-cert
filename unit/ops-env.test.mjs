// Unit tests for scripts/lib/ops-env.mjs — the one owner of the operational scripts'
// environment (Rule 12).
//
// It replaced six hand-copied `.env.local` loaders. Two of those split on `\n` only, and with a
// CRLF file JS `.` cannot consume the `\r`, so every line was silently skipped and the gate ran
// "not configured". The CRLF case below is the regression pin for that. The exit paths run in a
// child process because they call process.exit.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseDotEnv, loadEnvLocal } from '../scripts/lib/ops-env.mjs';

const MODULE_URL = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'lib', 'ops-env.mjs'),
).href;

/** Run `body` as an ES module that has imported ops-env as `ops`; return exit code + output. */
function runWith(env, body) {
  const source = `import * as ops from ${JSON.stringify(MODULE_URL)};\n${body}`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
    encoding: 'utf8',
  });
  return { code: child.status, out: `${child.stdout}${child.stderr}` };
}

describe('parseDotEnv', () => {
  test('reads CRLF files — the bug two of the old loaders had', () => {
    assert.deepEqual(parseDotEnv('A_ONE=1\r\nB_TWO=two\r\n'), [
      ['A_ONE', '1'],
      ['B_TWO', 'two'],
    ]);
  });

  test('strips one level of matching quotes and surrounding space', () => {
    assert.deepEqual(parseDotEnv(`A="x y"\nB='z'\nC = spaced \nD="mismatched'`), [
      ['A', 'x y'],
      ['B', 'z'],
      ['C', 'spaced'],
      ['D', `"mismatched'`],
    ]);
  });

  test('keeps a value containing $ digits literally', () => {
    assert.deepEqual(parseDotEnv('P="pa$2word"'), [['P', 'pa$2word']]);
  });

  test('ignores comments, blank lines, lowercase and malformed names', () => {
    assert.deepEqual(parseDotEnv('# A=1\n\nlower=2\n1BAD=3\nOK=4'), [['OK', '4']]);
  });
});

describe('loadEnvLocal', () => {
  test('fills unset names, and the real environment wins — including an empty value', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-env-'));
    try {
      const file = join(dir, '.env.local');
      writeFileSync(file, 'FROM_FILE=file\r\nALREADY=file\r\nFORCED_OFF=file\r\n');
      const target = { ALREADY: 'real', FORCED_OFF: '' };
      loadEnvLocal(file, target);
      assert.deepEqual(target, { ALREADY: 'real', FORCED_OFF: '', FROM_FILE: 'file' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a missing file is not an error (CI has none)', () => {
    const target = {};
    loadEnvLocal(join(tmpdir(), 'ops-env-does-not-exist', '.env.local'), target);
    assert.deepEqual(target, {});
  });

  test('an unreadable path is an error, not "every variable unset"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-env-'));
    try {
      // A directory where the file should be: EISDIR, which the first version swallowed.
      assert.throws(() => loadEnvLocal(dir, {}), { code: 'EISDIR' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('env / requireEnv', () => {
  test('env() treats empty as unset', () => {
    const r = runWith({ SET_ONE: 'v', EMPTY_ONE: '' }, `
      console.log(JSON.stringify([ops.env('SET_ONE'), ops.env('EMPTY_ONE') ?? null, ops.env('NOPE') ?? null]));`);
    assert.equal(r.code, 0, r.out);
    assert.equal(r.out.trim(), '["v",null,null]');
  });

  test('requireEnv exits 1 naming the variable and the reason', () => {
    const r = runWith({}, `ops.requireEnv('MISSING_VAR', 'Needed for the test.'); console.log('unreachable');`);
    assert.equal(r.code, 1);
    assert.match(r.out, /✗ MISSING_VAR is not set\.\n {2}Needed for the test\./);
    assert.doesNotMatch(r.out, /unreachable/);
  });
});

describe('supabaseProjectRef', () => {
  test('returns a valid ref from the environment', () => {
    const r = runWith({ SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst' }, `console.log(ops.supabaseProjectRef());`);
    assert.equal(r.code, 0, r.out);
    assert.equal(r.out.trim(), 'abcdefghijklmnopqrst');
  });

  test('returns null when unset and the link file is not consulted', () => {
    const r = runWith({}, `console.log(String(ops.supabaseProjectRef()));`);
    assert.equal(r.code, 0, r.out);
    assert.equal(r.out.trim(), 'null');
  });

  test('falls back to the link file only when asked, trimming its newline', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-env-'));
    try {
      const linkFile = join(dir, 'project-ref');
      writeFileSync(linkFile, 'abcdefghijklmnopqrst\r\n');
      const r = runWith({}, `
        const opts = { linkFile: ${JSON.stringify(linkFile)} };
        console.log(JSON.stringify([ops.supabaseProjectRef(opts), ops.supabaseProjectRef({ ...opts, fromLinkFile: true })]));`);
      assert.equal(r.code, 0, r.out);
      assert.equal(r.out.trim(), '[null,"abcdefghijklmnopqrst"]');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the environment wins over the link file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-env-'));
    try {
      const linkFile = join(dir, 'project-ref');
      writeFileSync(linkFile, 'zzzzzzzzzzzzzzzzzzzz');
      const r = runWith({ SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst' }, `
        console.log(ops.supabaseProjectRef({ fromLinkFile: true, linkFile: ${JSON.stringify(linkFile)} }));`);
      assert.equal(r.code, 0, r.out);
      assert.equal(r.out.trim(), 'abcdefghijklmnopqrst');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a tampered link file is refused and named as the source', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-env-'));
    try {
      const linkFile = join(dir, 'project-ref');
      writeFileSync(linkFile, 'x/../y');
      const r = runWith({}, `
        ops.supabaseProjectRef({ fromLinkFile: true, linkFile: ${JSON.stringify(linkFile)} }); console.log('unreachable');`);
      assert.equal(r.code, 1);
      assert.match(r.out, /supabase\/\.temp\/project-ref is not a valid project ref: x\/\.\.\/y/);
      assert.doesNotMatch(r.out, /unreachable/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const bad of ['x;y', 'abcdefghijklmnopqrs', 'ABCDEFGHIJKLMNOPQRST', 'abcdefghijklmnopqrst; rm']) {
    test(`refuses ${JSON.stringify(bad)} before it can reach a shell or URL`, () => {
      const r = runWith({ SUPABASE_PROJECT_REF: bad }, `ops.supabaseProjectRef(); console.log('unreachable');`);
      assert.equal(r.code, 1);
      assert.match(r.out, /SUPABASE_PROJECT_REF is not a valid project ref/);
      assert.doesNotMatch(r.out, /unreachable/);
    });
  }
});
