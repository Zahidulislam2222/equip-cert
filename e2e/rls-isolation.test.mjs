/**
 * Tenant isolation and privilege boundaries, executed against a real Supabase project.
 *
 * WHY THIS EXISTS
 *
 * Four of the defects found in this project were authorization defects, and not one of them
 * was visible to any gate the project had. A type checker cannot see through
 * `supabase.from('profiles').update({ role: 'admin' })`. A linter has no model of who is
 * allowed to do what. `next build` never opens a socket. Every one of these was found by a
 * person reading SQL, which does not scale and does not run on every push.
 *
 * Covered here, each named with the defect it would have caught:
 *
 *   DEF-020  a technician promoting themselves to administrator
 *   DEF-020  a user moving their own profile into another tenant
 *   DEF-017  cross-tenant reads and writes of evidence objects in storage
 *   DEF-018  deleting an unsigned inspection reporting success and doing nothing
 *   DEF-021  the plan limit being enforced by the database rather than the UI
 *   general  cross-tenant reads of every org-scoped table
 *
 * Run:  npm run test:rls
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and
 * SUPABASE_SERVICE_ROLE_KEY. It creates two throwaway organizations and removes them in the
 * teardown, so it is safe against a development project. It must NOT be pointed at a project
 * holding real customer data.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Same .env.local loading as scripts/check-live-dependencies.mjs. A test that silently
// skips because it could not find its configuration is worse than no test.
for (const line of safeRead(join(ROOT, '.env.local')).split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

function safeRead(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

const URL_ = required('NEXT_PUBLIC_SUPABASE_URL');
const ANON = required('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const SECRET = required('SUPABASE_SERVICE_ROLE_KEY');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set to run the isolation suite.`);
  return value;
}

/** Bypasses RLS. Used only to build and tear down the fixture, never to assert with. */
const admin = createClient(URL_, SECRET, { auth: { persistSession: false } });

/** A client carrying one user's session, i.e. exactly what a browser has. */
async function signedInAs(email, password) {
  const client = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Could not sign in ${email}: ${error.message}`);
  return client;
}

const RUN = Math.random().toString(36).slice(2, 10);
const PASSWORD = `Test-${RUN}-${Math.random().toString(36).slice(2)}`;

const fixture = {
  orgA: null,
  orgB: null,
  users: {}, // label -> { id, email, profileId, client }
};

async function makeOrg(label, plan) {
  const { data, error } = await admin
    .from('organizations')
    .insert({ name: `ISO ${label} ${RUN}`, slug: `iso-${label}-${RUN}`.toLowerCase(), plan })
    .select()
    .single();
  if (error) throw new Error(`Fixture org ${label}: ${error.message}`);
  return data;
}

async function makeUser(label, orgId, role) {
  const email = `iso-${label}-${RUN}@example.test`;
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (authError) throw new Error(`Fixture user ${label}: ${authError.message}`);

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .insert({ user_id: created.user.id, org_id: orgId, full_name: `ISO ${label}`, role })
    .select()
    .single();
  if (profileError) throw new Error(`Fixture profile ${label}: ${profileError.message}`);

  fixture.users[label] = {
    id: created.user.id,
    email,
    profileId: profile.id,
    client: await signedInAs(email, PASSWORD),
  };
}

before(async () => {
  // Org A is on the free plan so the plan-limit assertions have something to bite on.
  fixture.orgA = await makeOrg('a', 'free');
  fixture.orgB = await makeOrg('b', 'pro');

  await makeUser('a-admin', fixture.orgA.id, 'admin');
  await makeUser('a-tech', fixture.orgA.id, 'technician');
  await makeUser('b-admin', fixture.orgB.id, 'admin');
});

after(async () => {
  // Delete the auth users first: profiles cascade from them, and inspections then hold a NULL
  // inspector rather than blocking on a foreign key.
  for (const user of Object.values(fixture.users)) {
    await admin.auth.admin.deleteUser(user.id).catch(() => {});
  }
  for (const org of [fixture.orgA, fixture.orgB]) {
    if (org) await admin.from('organizations').delete().eq('id', org.id);
  }
});

describe('tenant isolation', () => {
  it('a member of one organization cannot read another organization', async () => {
    const { data } = await fixture.users['a-tech'].client
      .from('organizations')
      .select('id')
      .eq('id', fixture.orgB.id);

    // RLS filters rather than erroring, so the tell is an empty result, not a rejection.
    assert.deepEqual(data, [], 'org B was visible to a member of org A');
  });

  it('equipment is not readable across tenants', async () => {
    const { data: theirs } = await admin
      .from('equipment')
      .insert({ organization_id: fixture.orgB.id, name: `B asset ${RUN}` })
      .select()
      .single();

    const { data } = await fixture.users['a-tech'].client
      .from('equipment')
      .select('id')
      .eq('id', theirs.id);

    assert.deepEqual(data, [], 'org B equipment was visible to org A');
  });

  it('a member cannot write into another tenant', async () => {
    const { error } = await fixture.users['a-admin'].client
      .from('equipment')
      .insert({ organization_id: fixture.orgB.id, name: `smuggled ${RUN}` });

    assert.ok(error, 'writing equipment into another tenant was allowed');
  });
});

describe('privilege escalation (DEF-020)', () => {
  it('a technician cannot promote themselves to admin', async () => {
    const tech = fixture.users['a-tech'];

    const { error } = await tech.client
      .from('profiles')
      .update({ role: 'admin' })
      .eq('id', tech.profileId);

    assert.ok(error, 'a technician was able to set their own role to admin');

    // Assert the stored value too. An error that did not actually prevent the write would be
    // the worst of both worlds.
    const { data } = await admin.from('profiles').select('role').eq('id', tech.profileId).single();
    assert.equal(data.role, 'technician', 'the role changed despite the error');
  });

  it('a user cannot move their profile into another organization', async () => {
    const tech = fixture.users['a-tech'];

    const { error } = await tech.client
      .from('profiles')
      .update({ org_id: fixture.orgB.id })
      .eq('id', tech.profileId);

    assert.ok(error, 'a user was able to move themselves into another tenant');

    const { data } = await admin.from('profiles').select('org_id').eq('id', tech.profileId).single();
    assert.equal(data.org_id, fixture.orgA.id, 'the profile moved despite the error');
  });

  it('an admin cannot change their own role', async () => {
    const adminUser = fixture.users['a-admin'];
    const { error } = await adminUser.client
      .from('profiles')
      .update({ role: 'technician' })
      .eq('id', adminUser.profileId);

    assert.ok(error, 'an admin was able to change their own role');
  });
});

describe('write separation by role', () => {
  it('a technician cannot add equipment', async () => {
    const { error } = await fixture.users['a-tech'].client
      .from('equipment')
      .insert({ organization_id: fixture.orgA.id, name: `tech asset ${RUN}` });

    assert.ok(error, 'a technician was able to modify the equipment register');
  });

  it('a technician cannot read the audit log', async () => {
    await admin.from('audit_log').insert({
      organization_id: fixture.orgA.id,
      user_id: fixture.users['a-admin'].id,
      action: 'test',
      resource_type: 'test',
    });

    const { data } = await fixture.users['a-tech'].client.from('audit_log').select('id');
    assert.deepEqual(data, [], 'a technician could read the audit log');
  });

  it('the audit log is append-only even for an admin', async () => {
    const { data: row } = await admin
      .from('audit_log')
      .insert({
        organization_id: fixture.orgA.id,
        user_id: fixture.users['a-admin'].id,
        action: 'immutable',
        resource_type: 'test',
      })
      .select()
      .single();

    const { error } = await admin.from('audit_log').update({ action: 'rewritten' }).eq('id', row.id);
    assert.ok(error, 'an audit log entry was rewritten');
  });
});

describe('evidence storage (DEF-017)', () => {
  const file = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });

  it('a member can upload into their own organization path', async () => {
    const path = `${fixture.orgA.id}/inspection/${crypto.randomUUID()}.jpg`;
    const { error } = await fixture.users['a-tech'].client.storage
      .from('evidence')
      .upload(path, file(), { contentType: 'image/jpeg' });

    assert.equal(error, null, `own-tenant upload was rejected: ${error?.message}`);
  });

  it('a member cannot upload into another organization path', async () => {
    const path = `${fixture.orgB.id}/inspection/${crypto.randomUUID()}.jpg`;
    const { error } = await fixture.users['a-tech'].client.storage
      .from('evidence')
      .upload(path, file(), { contentType: 'image/jpeg' });

    assert.ok(error, 'evidence was written into another tenant path');
  });

  it('a member cannot sign a URL for another organization object', async () => {
    const path = `${fixture.orgB.id}/signature/${crypto.randomUUID()}.jpg`;
    await admin.storage.from('evidence').upload(path, file(), { contentType: 'image/jpeg' });

    const { data, error } = await fixture.users['a-tech'].client.storage
      .from('evidence')
      .createSignedUrl(path, 60);

    assert.ok(error || !data?.signedUrl, 'a signed URL was issued for another tenant object');
  });

  it('the evidence bucket is not public', async () => {
    // The whole of DEF-017 in one assertion: if this bucket is ever public again, every
    // policy above becomes decorative.
    const { data } = await admin.storage.getBucket('evidence');
    assert.equal(data.public, false, 'the evidence bucket is public');
  });
});

describe('inspection record integrity (DEF-018)', () => {
  async function makeInspection(orgId, extra = {}) {
    const { data, error } = await admin
      .from('inspections')
      .insert({
        organization_id: orgId,
        equipment_name: `Unit ${RUN}`,
        inspector_name: 'ISO fixture',
        status: 'Safe',
        ...extra,
      })
      .select()
      .single();
    if (error) throw new Error(`fixture inspection: ${error.message}`);
    return data;
  }

  it('an unsigned inspection is actually deleted, not silently kept', async () => {
    // The original trigger returned NEW on DELETE. NEW is NULL in a BEFORE DELETE row
    // trigger, and NULL cancels the operation — so this reported success and changed
    // nothing. Re-reading is the only way to tell the difference.
    const row = await makeInspection(fixture.orgB.id);

    const { error } = await admin.from('inspections').delete().eq('id', row.id);
    assert.equal(error, null, `deleting an unsigned inspection errored: ${error?.message}`);

    const { data } = await admin.from('inspections').select('id').eq('id', row.id);
    assert.deepEqual(data, [], 'the inspection still exists after a successful delete');
  });

  it('a signed inspection cannot be edited', async () => {
    const row = await makeInspection(fixture.orgB.id, {
      signature_url: `${fixture.orgB.id}/signature/${crypto.randomUUID()}.png`,
    });

    const { error } = await admin
      .from('inspections')
      .update({ status: 'Action Required' })
      .eq('id', row.id);

    assert.ok(error, 'a signed inspection record was edited');
  });

  it('a signed inspection cannot be deleted', async () => {
    const row = await makeInspection(fixture.orgB.id, {
      signature_url: `${fixture.orgB.id}/signature/${crypto.randomUUID()}.png`,
    });

    const { error } = await admin.from('inspections').delete().eq('id', row.id);
    assert.ok(error, 'a signed inspection record was deleted');

    const { data } = await admin.from('inspections').select('id').eq('id', row.id);
    assert.equal(data.length, 1, 'the signed record is gone');
  });
});

describe('plan limits are enforced by the database (DEF-021)', () => {
  it('the free plan rejects a signature', async () => {
    // Org A is on the free plan, whose feature list does not include signatures. The UI hides
    // the control; this asserts the database refuses it even when the UI is bypassed.
    const { error } = await admin.from('inspections').insert({
      organization_id: fixture.orgA.id,
      equipment_name: `Signed ${RUN}`,
      inspector_name: 'ISO fixture',
      status: 'Safe',
      signature_url: `${fixture.orgA.id}/signature/${crypto.randomUUID()}.png`,
    });

    assert.ok(error, 'the free plan accepted a digital signature');
  });

  it('the free plan rejects the eleventh inspection of the month', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      organization_id: fixture.orgA.id,
      equipment_name: `Bulk ${i} ${RUN}`,
      inspector_name: 'ISO fixture',
      status: 'Safe',
    }));

    const { error: bulkError } = await admin.from('inspections').insert(rows);
    assert.equal(bulkError, null, `seeding ten inspections failed: ${bulkError?.message}`);

    const { error } = await admin.from('inspections').insert({
      organization_id: fixture.orgA.id,
      equipment_name: `Over limit ${RUN}`,
      inspector_name: 'ISO fixture',
      status: 'Safe',
    });

    assert.ok(error, 'the free plan accepted an eleventh inspection');
    assert.match(String(error.message), /limit/i);
  });
});
