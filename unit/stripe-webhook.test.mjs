// Unit tests for the Stripe webhook body path (DEF-008) and placeholder secrets (DEF-003).
//
// DEF-008 was a handler that passed `req.body` to `constructEvent`. On Vercel that value is a
// JSON-parsed object, so the bytes Stripe signed no longer exist and every webhook is a 400.
// It was never seen because Stripe was unconfigured (DEF-003) — the handler returned 500 first.
//
// These tests run the REAL handler, bundled, over a REAL HTTP server, with a signature made by
// Stripe's own `generateTestHeaderString`. Each delivery target is reproduced the way it hands
// the body over:
//
//   vps     deploy/server.ts consumes the stream and stores the Buffer as a data property
//   vercel  @vercel/node buffers the body, replays it into the stream (restoreBody), and puts a
//           lazy JSON-parsing getter on req.body
//
// The Vercel runtime itself is not run here (it needs a Vercel login). Its replay is reproduced
// from @vercel/node's own source, and a guard test fails if that source stops matching the
// reproduction, so a runtime change cannot leave this suite passing against a fiction.
//
// All secrets are unmistakably fake (Rule 12). No request leaves the machine: the event type is
// one the handler does not act on, so it never reaches Supabase.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createServer, request as httpRequest } from 'node:http';
import { PassThrough } from 'node:stream';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import Stripe from 'stripe';

const FAKE_ENV = {
  STRIPE_SECRET_KEY: 'sk_test_unit-fake-key',
  STRIPE_WEBHOOK_SECRET: 'whsec_unit-fake-secret',
  SUPABASE_SERVICE_ROLE_KEY: 'unit-fake-service-role',
  NEXT_PUBLIC_SUPABASE_URL: 'https://unit-test.invalid',
  AI_API_KEY: 'unit-fake-ai-key',
};

// Pretty-printed on purpose: JSON.stringify(JSON.parse(x)) of this is a DIFFERENT byte string,
// which is exactly what made the old handler fail on Vercel.
const PAYLOAD = JSON.stringify(
  {
    id: 'evt_unit_test',
    object: 'event',
    type: 'customer.created',
    data: { object: { id: 'cus_unit_test', object: 'customer' } },
  },
  null,
  2,
);

let workDir;
let bundleSeq = 0;
const stripe = new Stripe(FAKE_ENV.STRIPE_SECRET_KEY);

/**
 * Bundle `entry` into a fresh module and import it with `env` applied. Every bundle inlines its
 * own copy of src/lib/config.ts, so each one evaluates the environment it was imported under.
 */
async function importWithEnv(entry, env) {
  const outFile = join(workDir, `bundle-${bundleSeq++}.mjs`);
  buildSync({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    logLevel: 'warning',
    outfile: outFile,
    absWorkingDir: process.cwd(),
  });
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await import(pathToFileURL(outFile).href);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function readAll(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** @vercel/node `restoreBody`, reproduced (see the guard test below). */
function vercelRestoreBody(req, body) {
  const replicate = new PassThrough();
  const on = replicate.on.bind(replicate);
  const originalOn = req.on.bind(req);
  req.read = replicate.read.bind(replicate);
  req.on = req.addListener = (name, cb) =>
    name === 'data' || name === 'end' ? on(name, cb) : originalOn(name, cb);
  replicate.write(body);
  replicate.end();
}

/** The handful of VercelResponse helpers the handler calls. */
function decorate(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(obj));
    return res;
  };
  return res;
}

/** Start a server that hands each request to `handler` the way `mode` delivers it. */
function startServer(handler, mode, probe) {
  const server = createServer(async (req, res) => {
    decorate(res);
    const raw = await readAll(req);
    if (mode === 'vps') {
      req.body = raw;
    } else if (mode === 'parsed') {
      req.body = JSON.parse(raw.toString('utf8'));
    } else if (mode === 'vercel') {
      vercelRestoreBody(req, raw);
      Object.defineProperty(req, 'body', {
        configurable: true,
        enumerable: true,
        get() {
          probe.bodyGetterReads += 1;
          return JSON.parse(raw.toString('utf8'));
        },
      });
    }
    try {
      await handler(req, res);
    } catch (err) {
      res.statusCode = 599;
      res.end(String(err));
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function post(server, body, headers) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, method: 'POST', path: '/api/webhooks/stripe', headers },
      async (res) => {
        const text = (await readAll(res)).toString('utf8');
        resolve({ status: res.statusCode, text });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

function signedHeaders(payload = PAYLOAD) {
  return {
    'content-type': 'application/json',
    'stripe-signature': stripe.webhooks.generateTestHeaderString({
      payload,
      secret: FAKE_ENV.STRIPE_WEBHOOK_SECRET,
    }),
  };
}

let handler;

before(async () => {
  const cacheRoot = join(process.cwd(), 'node_modules', '.cache');
  mkdirSync(cacheRoot, { recursive: true });
  workDir = mkdtempSync(join(cacheRoot, 'equipcert-stripe-'));
  handler = (await importWithEnv('api/webhooks/stripe.ts', FAKE_ENV)).default;
});

after(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe('the bug class DEF-008 describes', () => {
  test('a re-serialised body fails Stripe verification', () => {
    const reserialised = JSON.stringify(JSON.parse(PAYLOAD));
    assert.notEqual(reserialised, PAYLOAD);
    assert.throws(() =>
      stripe.webhooks.constructEvent(
        reserialised,
        signedHeaders()['stripe-signature'],
        FAKE_ENV.STRIPE_WEBHOOK_SECRET,
      ),
    );
  });
});

describe('the real handler, per delivery target', () => {
  test('self-host adapter (Buffer data property) → 200', async (t) => {
    const server = await startServer(handler, 'vps', {});
    t.after(() => server.close());
    const r = await post(server, PAYLOAD, signedHeaders());
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(JSON.parse(r.text), { received: true });
  });

  test('Vercel replay (lazy getter) → 200, and the getter is never read', async (t) => {
    const probe = { bodyGetterReads: 0 };
    const server = await startServer(handler, 'vercel', probe);
    t.after(() => server.close());
    const r = await post(server, PAYLOAD, signedHeaders());
    assert.equal(r.status, 200, r.text);
    assert.equal(probe.bodyGetterReads, 0, 'handler read req.body and triggered the JSON parse');
  });

  test('untouched stream (no body property at all) → 200', async (t) => {
    // The shape Vercel delivers with helpers disabled (NODEJS_HELPERS=0).
    const server = createServer((req, res) => handler(req, decorate(res)));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    t.after(() => server.close());
    const r = await post(server, PAYLOAD, signedHeaders());
    assert.equal(r.status, 200, r.text);
  });

  test('an already-parsed body is refused, not re-serialised → 400', async (t) => {
    // A re-serialising handler would ALSO answer 400 (the payload is pretty-printed), so the
    // status alone proves nothing. The refusal is identified by its own log line.
    const logged = [];
    const original = console.error;
    console.error = (...args) => logged.push(args.join(' '));
    t.after(() => {
      console.error = original;
    });
    const server = await startServer(handler, 'parsed', {});
    t.after(() => server.close());
    const r = await post(server, PAYLOAD, signedHeaders());
    console.error = original;
    assert.equal(r.status, 400, r.text);
    assert.ok(
      logged.some((l) => l.includes('parsed before signature verification')),
      `refusal not logged: ${logged.join(' | ')}`,
    );
    assert.ok(!logged.some((l) => l.includes('signature verification failed')), 'body reached constructEvent');
  });

  test('a tampered body → 400', async (t) => {
    const server = await startServer(handler, 'vercel', { bodyGetterReads: 0 });
    t.after(() => server.close());
    const r = await post(server, PAYLOAD.replace('cus_unit_test', 'cus_attacker'), signedHeaders());
    assert.equal(r.status, 400, r.text);
  });

  test('no Stripe-Signature header → 400', async (t) => {
    const server = await startServer(handler, 'vps', {});
    t.after(() => server.close());
    const r = await post(server, PAYLOAD, { 'content-type': 'application/json' });
    assert.equal(r.status, 400, r.text);
  });

  test('GET → 405', async (t) => {
    const server = createServer((req, res) => handler(req, decorate(res)));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    t.after(() => server.close());
    const { port } = server.address();
    const status = await new Promise((resolve, reject) => {
      httpRequest({ host: '127.0.0.1', port, path: '/api/webhooks/stripe' }, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
        .on('error', reject)
        .end();
    });
    assert.equal(status, 405);
  });
});

describe('the reproduction still matches @vercel/node', () => {
  test('restoreBody replays only data/end and the body getter is lazy', () => {
    const src = readFileSync('node_modules/@vercel/node/dist/dev-server.mjs', 'utf8');
    assert.match(src, /function restoreBody\(req, body\)/);
    assert.match(src, /name === "data" \|\| name === "end" \? on\(name, cb\) : originalOn\(name, cb\)/);
    assert.match(src, /setLazyProp\(req, "body", getBodyParser\(body, contentType\)\)/);
  });
});

describe('placeholder secrets (DEF-003)', () => {
  test('.env.example values count as unset; names are listed, values are not', async () => {
    const { serverConfig } = await importWithEnv('src/lib/config.ts', {
      ...FAKE_ENV,
      STRIPE_SECRET_KEY: 'sk_test_...',
      STRIPE_WEBHOOK_SECRET: 'whsec_...',
      SUPABASE_SERVICE_ROLE_KEY: 'your-supabase-service-role-key',
      AI_API_KEY: 'your-ai-api-key',
    });
    assert.equal(serverConfig.stripe.secretKey, '');
    assert.equal(serverConfig.stripe.webhookSecret, '');
    assert.equal(serverConfig.supabase.serviceRoleKey, '');
    assert.equal(serverConfig.ai.apiKey, '');
    assert.deepEqual([...serverConfig.placeholderSecrets].sort(), [
      'AI_API_KEY',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'SUPABASE_SERVICE_ROLE_KEY',
    ]);
  });

  test('a placeholder AI_API_KEY does not mask a real legacy GOOGLE_AI_API_KEY', async () => {
    const { serverConfig } = await importWithEnv('src/lib/config.ts', {
      ...FAKE_ENV,
      AI_API_KEY: 'your-ai-api-key',
      GOOGLE_AI_API_KEY: 'unit-fake-legacy-key',
    });
    assert.equal(serverConfig.ai.apiKey, 'unit-fake-legacy-key');
    assert.deepEqual(serverConfig.placeholderSecrets, ['AI_API_KEY']);
  });

  test('real-shaped values are kept; unset stays empty', async () => {
    const { serverConfig } = await importWithEnv('src/lib/config.ts', {
      ...FAKE_ENV,
      AI_API_KEY: undefined,
      GOOGLE_AI_API_KEY: undefined,
    });
    assert.equal(serverConfig.stripe.secretKey, FAKE_ENV.STRIPE_SECRET_KEY);
    assert.equal(serverConfig.stripe.webhookSecret, FAKE_ENV.STRIPE_WEBHOOK_SECRET);
    assert.equal(serverConfig.supabase.serviceRoleKey, FAKE_ENV.SUPABASE_SERVICE_ROLE_KEY);
    assert.equal(serverConfig.ai.apiKey, '');
    assert.deepEqual(serverConfig.placeholderSecrets, []);
  });

  test('the handler answers "not configured" for a placeholder, naming no value', async (t) => {
    const mod = await importWithEnv('api/webhooks/stripe.ts', {
      ...FAKE_ENV,
      STRIPE_WEBHOOK_SECRET: 'whsec_...',
    });
    const logged = [];
    const original = console.error;
    console.error = (...args) => logged.push(args.join(' '));
    t.after(() => {
      console.error = original;
    });
    const server = await startServer(mod.default, 'vps', {});
    t.after(() => server.close());
    const r = await post(server, PAYLOAD, signedHeaders());
    console.error = original;
    assert.equal(r.status, 500);
    assert.match(r.text, /not configured/);
    assert.ok(logged.some((l) => l.includes('STRIPE_WEBHOOK_SECRET')), logged.join('\n'));
    assert.ok(!logged.some((l) => l.includes('whsec_')), 'a secret value reached the log');
  });
});
