// Unit tests for the breached-password check (src/lib/password-safety.ts).
//
// The module makes a privacy promise in its header — the password and its full hash never leave
// the device; only a 5-character SHA-1 prefix does — and an availability promise: a breach-list
// outage must not become a signup outage. Both were verified by reading only (DEF-002). These
// tests assert them against a stubbed `fetch`, so no request leaves the machine.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const RANGE_URL = 'https://pwned.test/range';
const MIN_LENGTH = 12;
const PASSWORD = 'correct-horse-unit-test';
const HASH = createHash('sha1').update(PASSWORD).digest('hex').toUpperCase();

let mod;
let workDir;
const realFetch = globalThis.fetch;
let calls;
let respond;

before(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'equipcert-unit-'));
  const outFile = join(workDir, 'password-safety.mjs');
  buildSync({
    entryPoints: ['src/lib/password-safety.ts'],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'warning',
    outfile: outFile,
  });
  // config.ts reads these at import time; values are unmistakably fake (Rule 12).
  process.env.NEXT_PUBLIC_PWNED_RANGE_URL = RANGE_URL;
  process.env.NEXT_PUBLIC_PASSWORD_MIN_LENGTH = String(MIN_LENGTH);
  process.env.NEXT_PUBLIC_PWNED_TIMEOUT_MS = '1000';
  mod = await import(pathToFileURL(outFile).href);
});

after(() => {
  globalThis.fetch = realFetch;
  delete process.env.NEXT_PUBLIC_PWNED_RANGE_URL;
  delete process.env.NEXT_PUBLIC_PASSWORD_MIN_LENGTH;
  delete process.env.NEXT_PUBLIC_PWNED_TIMEOUT_MS;
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

beforeEach(() => {
  calls = [];
  respond = async () => new Response('', { status: 200 });
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return respond(url, init);
  };
});

describe('what leaves the device', () => {
  test('only the 5-character prefix is sent, with padding requested', async () => {
    await mod.breachCount(PASSWORD);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${RANGE_URL}/${HASH.slice(0, 5)}`);
    assert.ok(!calls[0].url.includes(HASH.slice(5)), 'the hash suffix left the device');
    assert.ok(!calls[0].url.includes(PASSWORD), 'the password left the device');
    assert.equal(calls[0].init.headers['Add-Padding'], 'true');
  });
});

describe('matching', () => {
  test('a listed suffix returns its count', async () => {
    respond = async () =>
      new Response(`0000000000000000000000000000000000A:3\r\n${HASH.slice(5)}:4242\r\n`, {
        status: 200,
      });
    assert.equal(await mod.breachCount(PASSWORD), 4242);
  });

  test('padding lines (count 0) and other suffixes do not match', async () => {
    respond = async () =>
      new Response('0000000000000000000000000000000000A:0\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:9\n', {
        status: 200,
      });
    assert.equal(await mod.breachCount(PASSWORD), 0);
  });
});

describe('an outage fails open, by design', () => {
  test('network error → 0', async () => {
    respond = async () => {
      throw new TypeError('fetch failed');
    };
    assert.equal(await mod.breachCount(PASSWORD), 0);
  });

  test('HTTP 503 → 0', async () => {
    respond = async () => new Response('busy', { status: 503 });
    assert.equal(await mod.breachCount(PASSWORD), 0);
  });
});

describe('checkPassword', () => {
  test('too short is rejected without any network call', async () => {
    const v = await mod.checkPassword('short');
    assert.deepEqual(v, { ok: false, reason: 'too_short', minLength: MIN_LENGTH });
    assert.equal(calls.length, 0);
  });

  test('breached is rejected with the count; clean is accepted', async () => {
    respond = async () => new Response(`${HASH.slice(5)}:7\n`, { status: 200 });
    assert.deepEqual(await mod.checkPassword(PASSWORD), {
      ok: false,
      reason: 'breached',
      occurrences: 7,
    });
    respond = async () => new Response('', { status: 200 });
    assert.deepEqual(await mod.checkPassword(PASSWORD), { ok: true });
  });

  test('describeVerdict gives guidance, and nothing for ok', () => {
    assert.equal(mod.describeVerdict({ ok: true }), null);
    assert.match(mod.describeVerdict({ ok: false, reason: 'too_short', minLength: 12 }), /12/);
    assert.match(
      mod.describeVerdict({ ok: false, reason: 'breached', occurrences: 7 }),
      /known data breaches/,
    );
  });
});
