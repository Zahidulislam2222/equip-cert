// Unit tests for the consent module.
//
// First entry in the unit suite. DEF-002 has recorded "no automated test suite exists" since
// the project began; this starts closing it with the logic where a silent regression has the
// highest cost — a consent bug is a regulatory failure that no type check can see.
//
// The module under test is TypeScript with a `@/` path alias and a JSON import, so it is
// bundled with esbuild (already a build dependency) rather than imported directly. The bundle
// is what the browser would run, which makes this a test of shipped behaviour rather than of
// a reimplementation.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let consent;
let workDir;

/** Minimal in-memory Storage that also lets a test simulate a throwing storage. */
function makeStorage() {
  const map = new Map();
  return {
    throwOnAccess: false,
    getItem(k) {
      if (this.throwOnAccess) throw new Error('storage disabled');
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      if (this.throwOnAccess) throw new Error('storage disabled');
      map.set(k, String(v));
    },
    removeItem(k) {
      if (this.throwOnAccess) throw new Error('storage disabled');
      map.delete(k);
    },
    keys: () => [...map.keys()],
    _map: map,
  };
}

before(() => {
  workDir = mkdtempSync(join(tmpdir(), 'equipcert-unit-'));
  const outFile = join(workDir, 'consent.mjs');
  execFileSync(
    process.execPath,
    [
      join('node_modules', 'esbuild', 'bin', 'esbuild'),
      'src/lib/compliance/consent.ts',
      '--bundle',
      '--format=esm',
      '--platform=neutral',
      '--log-level=warning',
      `--outfile=${outFile}`,
    ],
    { stdio: 'inherit' },
  );
  return import(pathToFileURL(outFile).href).then((m) => {
    consent = m;
  });
});

after(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe('GPC detection', () => {
  test('absent navigator does not throw and reports no signal', () => {
    delete globalThis.navigator;
    assert.equal(consent.hasGpcSignal(), false);
  });

  test('reports a signal only for exactly true', () => {
    globalThis.navigator = { globalPrivacyControl: true };
    assert.equal(consent.hasGpcSignal(), true);

    // A truthy string is not a GPC signal. Accepting one would let any page that sets a
    // stray property force an opt-out we then report as the user's choice.
    globalThis.navigator = { globalPrivacyControl: 'yes' };
    assert.equal(consent.hasGpcSignal(), false);

    globalThis.navigator = {};
    assert.equal(consent.hasGpcSignal(), false);
  });
});

describe('default state is deny', () => {
  test('nothing optional is granted before a decision', () => {
    globalThis.window = { localStorage: makeStorage(), sessionStorage: makeStorage() };
    assert.equal(consent.readConsent(), null);
    assert.equal(consent.isGranted('preferences'), false);
  });

  test('essential is always granted', () => {
    assert.equal(consent.isGranted('essential'), true);
  });
});

describe('storing and reading a decision', () => {
  test('a rejection round-trips and grants nothing optional', () => {
    const storage = makeStorage();
    globalThis.window = { localStorage: storage, sessionStorage: makeStorage() };

    consent.writeConsent(consent.denyAllOptional(), false);
    const read = consent.readConsent();

    assert.ok(read, 'decision should persist');
    assert.equal(read.categories.essential, true);
    assert.equal(read.categories.preferences, false);
    assert.equal(read.viaGpc, false);
    assert.equal(consent.isGranted('preferences', read), false);
  });

  test('acceptance grants the optional category', () => {
    globalThis.window = { localStorage: makeStorage(), sessionStorage: makeStorage() };
    consent.writeConsent(consent.grantAllOptional(), false);
    assert.equal(consent.isGranted('preferences'), true);
  });

  test('essential cannot be switched off by a caller', () => {
    globalThis.window = { localStorage: makeStorage(), sessionStorage: makeStorage() };
    consent.writeConsent({ essential: false, preferences: false }, false);
    assert.equal(consent.readConsent().categories.essential, true);
  });
});

describe('withdrawal actually removes stored data', () => {
  test('rejecting preferences purges the keys they were allowed to write', () => {
    const local = makeStorage();
    const session = makeStorage();
    globalThis.window = { localStorage: local, sessionStorage: session };

    // Simulate a browser that had previously consented and stored optional values.
    consent.writeConsent(consent.grantAllOptional(), false);
    local.setItem('theme', 'dark');
    session.setItem('ec:intro-played', '1');

    consent.writeConsent(consent.denyAllOptional(), false);

    // A "preferences: false" flag sitting next to a surviving theme key is a promise of
    // withdrawal, not withdrawal. DEF-029 is exactly this class of bug.
    assert.equal(local.getItem('theme'), null, 'theme must be purged on withdrawal');
    assert.equal(session.getItem('ec:intro-played'), null, 'intro flag must be purged');
  });
});

describe('a decision is tied to the document version it was given against', () => {
  test('a decision stored against another version is not honoured', () => {
    const storage = makeStorage();
    globalThis.window = { localStorage: storage, sessionStorage: makeStorage() };

    consent.writeConsent(consent.grantAllOptional(), false);
    const key = storage.keys().find((k) => k.startsWith('equipcert-consent'));
    const stored = JSON.parse(storage.getItem(key));

    stored.documentVersion = '1999-01-01';
    storage.setItem(key, JSON.stringify(stored));

    // Consent to a document that has since been rewritten is not consent to this one.
    assert.equal(consent.readConsent(), null);
    assert.equal(consent.isGranted('preferences'), false);
  });

  test('corrupt stored JSON is treated as no decision, not as consent', () => {
    const storage = makeStorage();
    globalThis.window = { localStorage: storage, sessionStorage: makeStorage() };
    consent.writeConsent(consent.grantAllOptional(), false);
    const key = storage.keys().find((k) => k.startsWith('equipcert-consent'));
    storage.setItem(key, '{not json');
    assert.equal(consent.readConsent(), null);
  });
});

describe('hostile storage environments', () => {
  test('a throwing localStorage never crashes the caller and never fakes consent', () => {
    const storage = makeStorage();
    globalThis.window = { localStorage: storage, sessionStorage: makeStorage() };
    storage.throwOnAccess = true;

    // Private mode, disabled site data and some embedded webviews all throw here. A privacy
    // control that crashes the page on load is worse than the problem it solves.
    assert.doesNotThrow(() => consent.readConsent());
    assert.equal(consent.readConsent(), null);
    assert.doesNotThrow(() => consent.writeConsent(consent.denyAllOptional(), false));
    assert.equal(consent.isGranted('preferences'), false);
  });
});

describe('GPC produces a recorded opt-out, not a silent one', () => {
  test('a GPC-driven decision is marked so the UI can confirm it', () => {
    globalThis.window = { localStorage: makeStorage(), sessionStorage: makeStorage() };
    const decision = consent.writeConsent(consent.denyAllOptional(), true);

    // From 1 Jan 2026 the consumer must be able to confirm the signal was processed, which
    // is only possible if the decision records that GPC caused it.
    assert.equal(decision.viaGpc, true);
    assert.equal(consent.readConsent().viaGpc, true);
    assert.equal(consent.isGranted('preferences'), false);
  });
});
