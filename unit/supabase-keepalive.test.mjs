// Unit tests for the keepalive (DEF-069).
//
// The old keepalive could only ever pass: its request never touched Postgres, so "green" said
// nothing about whether the project was being counted as active. These tests pin the one
// property that matters — the script exits 0 only for a response a Postgres SELECT produced —
// and they run the REAL script as a child process, because the first review of this fix found
// a main-module guard that skipped main() and exited 0 when reached through a junction. A test
// of the verdict function alone passed straight over that.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  verifyKeepaliveResponse,
  parseBaseUrl,
  describeNetworkError,
  KEEPALIVE_PATH,
  SUCCESS_PREFIX,
} from '../scripts/supabase-keepalive.mjs';

const SCRIPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const SCRIPT = join(SCRIPTS_DIR, 'supabase-keepalive.mjs');
const FAKE_KEY = 'test-key';

/** Run the script for real; resolve with exit code and stdout. */
function runScript(env, scriptPath = SCRIPT) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out }));
  });
}

/** A local server whose handler the test controls; records every request it receives. */
function startServer(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, apikey: req.headers.apikey, authorization: req.headers.authorization });
    handler(req, res);
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` }),
    ),
  );
}

describe('verifyKeepaliveResponse', () => {
  test('accepts a PostgREST row from plan_limits', () => {
    const result = verifyKeepaliveResponse(200, '[{"plan_id":"free"}]');
    assert.equal(result.ok, true);
    assert.equal(result.row.plan_id, 'free');
  });

  test('rejects the GoTrue health body the old keepalive accepted', () => {
    // A 200 that proves nothing about the database is exactly the DEF-069 failure.
    const result = verifyKeepaliveResponse(200, '{"version":"v2","name":"GoTrue"}');
    assert.equal(result.ok, false);
    assert.match(result.reason, /not a JSON array/);
  });

  test('rejects non-200 statuses, including the 401 an unprivileged key gets', () => {
    for (const status of [401, 403, 404, 500, 503]) {
      assert.equal(verifyKeepaliveResponse(status, '[{"plan_id":"free"}]').ok, false, `status ${status}`);
    }
  });

  test('rejects an empty array — the seed is missing or the key cannot read it', () => {
    const result = verifyKeepaliveResponse(200, '[]');
    assert.equal(result.ok, false);
    assert.match(result.reason, /no rows/);
  });

  test('rejects HTML, garbage and empty bodies', () => {
    for (const body of ['<!doctype html><html></html>', 'not json', '']) {
      assert.equal(verifyKeepaliveResponse(200, body).ok, false, `body ${JSON.stringify(body)}`);
    }
  });

  test('rejects rows that are not from plan_limits', () => {
    for (const body of ['[null]', '[1]', '[{"id":"x"}]', '[{"plan_id":42}]']) {
      assert.equal(verifyKeepaliveResponse(200, body).ok, false, `body ${body}`);
    }
  });
});

describe('parseBaseUrl', () => {
  test('accepts https and loopback http', () => {
    assert.equal(parseBaseUrl('https://example.supabase.co/').base, 'https://example.supabase.co');
    assert.equal(parseBaseUrl('http://127.0.0.1:54321').ok, true);
    assert.equal(parseBaseUrl('http://localhost:54321').ok, true);
  });

  test('refuses plain http to a real host — the key would travel in cleartext', () => {
    const result = parseBaseUrl('http://example.supabase.co');
    assert.equal(result.ok, false);
    assert.match(result.reason, /must be https/);
  });

  test('refuses embedded credentials — fetch would echo them in an error', () => {
    const result = parseBaseUrl('https://u:p@example.supabase.co');
    assert.equal(result.ok, false);
    assert.match(result.reason, /username or password/);
  });

  test('refuses a value with no scheme instead of crashing', () => {
    assert.equal(parseBaseUrl('example.supabase.co').ok, false);
    assert.equal(parseBaseUrl('').ok, false);
  });
});

describe('describeNetworkError', () => {
  test('only ENOTFOUND is reported as a vanished project', () => {
    assert.match(describeNetworkError({ cause: { code: 'ENOTFOUND' } }), /paused or deleted/);
    const refused = describeNetworkError({ name: 'TypeError', cause: { code: 'ECONNREFUSED' } });
    assert.match(refused, /ECONNREFUSED/);
    assert.doesNotMatch(refused, /paused or deleted/);
    assert.doesNotMatch(refused, /redirect/, 'a refused connection is not a redirect problem');
    const redirect = describeNetworkError({ name: 'TypeError', message: 'fetch failed', cause: { message: 'unexpected redirect' } });
    assert.match(redirect, /redirect is refused on purpose/);
  });
});

describe('the script, run as a real process', () => {
  let tmp;
  let good;
  let redirectTarget;
  let redirector;

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'keepalive-'));
    good = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('[{"plan_id":"free"}]');
    });
    redirectTarget = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('[{"plan_id":"free"}]');
    });
    redirector = await startServer((_req, res) => {
      res.writeHead(302, { location: `${redirectTarget.base}${KEEPALIVE_PATH}` });
      res.end();
    });
  });

  after(() => {
    for (const s of [good, redirectTarget, redirector]) s?.server.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('empty secrets exit non-zero with an annotation', async () => {
    const { code, out } = await runScript({ NEXT_PUBLIC_SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' });
    assert.notEqual(code, 0);
    assert.match(out, /::error title=Keepalive is inert::/);
  });

  test('reached through a directory junction/symlink it still runs main() and fails loudly', async () => {
    const link = join(tmp, 'scripts-link');
    symlinkSync(SCRIPTS_DIR, link, 'junction'); // 'junction' on Windows, a dir symlink elsewhere
    const { code, out } = await runScript(
      { NEXT_PUBLIC_SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' },
      join(link, 'supabase-keepalive.mjs'),
    );
    assert.notEqual(code, 0, 'a skipped main() exits 0 — the regression the first review found');
    assert.match(out, /::error/);
  });

  test('a URL with no scheme fails with an annotation, not a stack trace', async () => {
    const { code, out } = await runScript({
      NEXT_PUBLIC_SUPABASE_URL: 'example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY,
    });
    assert.notEqual(code, 0);
    assert.match(out, /::error title=Keepalive is misconfigured::/);
  });

  test('a verified row exits 0, prints the asserted line, and made exactly the read-only query', async () => {
    const { code, out } = await runScript({
      NEXT_PUBLIC_SUPABASE_URL: good.base,
      SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY,
    });
    assert.equal(code, 0, out);
    assert.ok(out.startsWith(SUCCESS_PREFIX), out);
    assert.equal(good.seen.length, 1);
    assert.equal(good.seen[0].url, '/rest/v1/plan_limits?select=plan_id&limit=1');
    assert.equal(good.seen[0].apikey, FAKE_KEY);
  });

  test('a redirect is refused and the key never reaches the redirect target', async () => {
    const { code, out } = await runScript({
      NEXT_PUBLIC_SUPABASE_URL: redirector.base,
      SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY,
    });
    assert.notEqual(code, 0);
    assert.match(out, /::error title=Supabase is unreachable::/);
    assert.equal(redirector.seen.length, 1);
    assert.equal(redirectTarget.seen.length, 0, 'the key was forwarded across a redirect');
  });
});
