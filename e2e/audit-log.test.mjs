/**
 * The audit log is written by the database, and it never blocks erasure.
 *
 * WHY THIS EXISTS
 *
 * `public.audit_log` shipped append-only and RLS-forced, and nothing wrote to it. The emptiness
 * hid DEF-059: the append-only trigger rejected EVERY update and delete, including the three the
 * schema itself issues — the GDPR erasure routine's redaction, the ON DELETE SET NULL when an auth
 * user is removed, and the ON DELETE CASCADE when an organisation is removed. Each of those would
 * have failed the first time a subject had a single audit entry.
 *
 * Covered here:
 *
 *   A3       writes are recorded by triggers, whichever client made them
 *   A3       a technician cannot read the log, an admin can, nobody can forge an entry
 *   A3       an entry cannot be edited, only redacted in the exact permitted shape
 *   DEF-059  erasure succeeds for a subject with audit entries, and redacts them
 *   DEF-059  deleting a user with audit entries succeeds
 *   DEF-059  deleting an organisation with audit entries succeeds
 *
 * Run:  npm run test:rls   (all e2e suites)
 *
 * Same requirements and the same warning as rls-isolation.test.mjs: throwaway fixtures, removed in
 * the teardown, never against a project holding real customer data.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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
  if (!value) throw new Error(`${name} must be set to run the audit suite.`);
  return value;
}

const admin = createClient(URL_, SECRET, { auth: { persistSession: false } });

const RUN = Math.random().toString(36).slice(2, 10);
const PASSWORD = `Test-${RUN}-${Math.random().toString(36).slice(2)}`;

const fixture = { orgs: [], users: {} };

async function makeOrg(label, plan = 'pro') {
  const { data, error } = await admin
    .from('organizations')
    .insert({ name: `AUD ${label} ${RUN}`, slug: `aud-${label}-${RUN}`.toLowerCase(), plan })
    .select()
    .single();
  if (error) throw new Error(`Fixture org ${label}: ${error.message}`);
  fixture.orgs.push(data);
  return data;
}

async function makeUser(label, orgId, role) {
  const email = `aud-${label}-${RUN}@example.test`;
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (authError) throw new Error(`Fixture user ${label}: ${authError.message}`);

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .insert({ user_id: created.user.id, org_id: orgId, full_name: `AUD ${label}`, role })
    .select()
    .single();
  if (profileError) throw new Error(`Fixture profile ${label}: ${profileError.message}`);

  const client = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Could not sign in ${label}: ${error.message}`);

  const user = { id: created.user.id, email, profileId: profile.id, client };
  fixture.users[label] = user;
  return user;
}

/** Audit entries for one org, read with the service role so the assertion is not RLS-shaped. */
async function entries(orgId, filter = {}) {
  let q = admin.from('audit_log').select('*').eq('organization_id', orgId);
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
  const { data, error } = await q.order('created_at', { ascending: true });
  if (error) throw new Error(`Reading audit entries: ${error.message}`);
  return data;
}

let org;

before(async () => {
  org = await makeOrg('main');
  await makeUser('admin', org.id, 'admin');
  await makeUser('tech', org.id, 'technician');
});

after(async () => {
  for (const user of Object.values(fixture.users)) {
    await admin.auth.admin.deleteUser(user.id).catch(() => {});
  }
  for (const o of fixture.orgs) {
    await admin.from('organizations').delete().eq('id', o.id);
  }
});

describe('audit log — written by the database', () => {
  it('records an inspection a technician creates, with the technician as actor', async () => {
    const tech = fixture.users.tech;
    const { data: row, error } = await tech.client
      .from('inspections')
      .insert({
        organization_id: org.id,
        inspector_id: tech.profileId,
        equipment_name: 'AUD extinguisher',
        inspector_name: 'AUD tech',
        status: 'Safe',
      })
      .select()
      .single();
    assert.equal(error, null, error?.message);

    const found = await entries(org.id, { action: 'inspection.created', resource_id: String(row.id) });
    assert.equal(found.length, 1, 'no audit entry for the inspection insert');
    assert.equal(found[0].user_id, tech.id, 'the entry does not name the technician as actor');
    assert.equal(found[0].resource_type, 'inspections');
    assert.equal(found[0].details.status, 'Safe');
    assert.equal(found[0].ip_address, null, 'a trigger must not record a client-supplied address');
  });

  it('records a role change, naming what it changed from', async () => {
    const { data: target } = await admin
      .from('profiles')
      .select('id')
      .eq('id', fixture.users.tech.profileId)
      .single();

    const { error } = await fixture.users.admin.client
      .from('profiles')
      .update({ role: 'manager' })
      .eq('id', target.id);
    assert.equal(error, null, error?.message);

    const found = await entries(org.id, { action: 'member.role_changed', resource_id: target.id });
    assert.equal(found.length, 1, 'no audit entry for the role change');
    assert.equal(found[0].details.role_from, 'technician');
    assert.equal(found[0].details.role, 'manager');
    assert.equal(found[0].user_id, fixture.users.admin.id);

    // Put it back so the read-permission test below still has a technician.
    await fixture.users.admin.client.from('profiles').update({ role: 'technician' }).eq('id', target.id);
  });

  it('never records personal data in an entry', async () => {
    const all = await entries(org.id);
    assert.ok(all.length > 0);
    for (const e of all) {
      const text = JSON.stringify(e.details);
      assert.ok(!text.includes('@example.test'), `entry ${e.action} carries an email address`);
      assert.ok(!text.includes('AUD tech'), `entry ${e.action} carries a name`);
    }
  });

  it('is readable by an admin and not by a technician', async () => {
    const { data: asAdmin } = await fixture.users.admin.client.from('audit_log').select('id');
    assert.ok(asAdmin.length > 0, 'an admin could not read their own organisation audit log');

    const { data: asTech } = await fixture.users.tech.client.from('audit_log').select('id');
    assert.deepEqual(asTech, [], 'a technician could read the audit log');
  });

  it('cannot be forged by a signed-in client', async () => {
    const { error } = await fixture.users.admin.client.from('audit_log').insert({
      organization_id: org.id,
      action: 'inspection.created',
      resource_type: 'inspections',
    });
    assert.ok(error, 'a client wrote its own audit entry');
  });

  it('rejects an edit even from the service role', async () => {
    const [first] = await entries(org.id);
    const { error } = await admin.from('audit_log').update({ action: 'rewritten' }).eq('id', first.id);
    assert.ok(error, 'an audit entry was rewritten');

    const { error: disguised } = await admin
      .from('audit_log')
      .update({ user_id: null, action: 'rewritten' })
      .eq('id', first.id);
    assert.ok(disguised, 'an edit disguised as a redaction was accepted');

    const { error: del } = await admin.from('audit_log').delete().eq('id', first.id);
    assert.ok(del, 'an audit entry was deleted directly');
  });
});

describe('DEF-059 — the audit log never blocks erasure', () => {
  it('erases a subject who has audit entries, keeping the record and redacting the entries', async () => {
    const subject = await makeUser('erase', org.id, 'technician');
    const { data: inspection, error: insertError } = await subject.client
      .from('inspections')
      .insert({
        organization_id: org.id,
        inspector_id: subject.profileId,
        equipment_name: 'AUD erase extinguisher',
        inspector_name: 'AUD erase',
        status: 'Safe',
      })
      .select()
      .single();
    assert.equal(insertError, null, insertError?.message);
    assert.ok((await entries(org.id, { user_id: subject.id })).length > 0, 'fixture has no entries to redact');

    // An entry ABOUT the subject, written by someone else: the admin changes their role.
    const { error: roleError } = await fixture.users.admin.client
      .from('profiles')
      .update({ role: 'manager' })
      .eq('id', subject.profileId);
    assert.equal(roleError, null, roleError?.message);
    const about = async () => entries(org.id, { 'details->>subject_user_id': subject.id });
    assert.ok((await about()).length > 0, 'fixture has no entries about the subject to redact');

    const { error } = await admin.rpc('erase_subject', { p_profile_id: subject.profileId });
    assert.equal(error, null, `erasure failed: ${error?.message}`);

    assert.equal((await entries(org.id, { user_id: subject.id })).length, 0, 'entries still name the subject');
    assert.equal((await about()).length, 0, 'entries about the subject still carry their user id');
    const roleChange = await entries(org.id, { action: 'member.role_changed', resource_id: subject.profileId });
    assert.equal(roleChange.length, 1, 'the role change entry was lost');
    assert.equal(roleChange[0].user_id, fixture.users.admin.id, "erasure removed the ADMIN's actor reference");
    assert.equal(roleChange[0].details.role, 'manager', 'non-personal details were stripped');

    const { data: kept } = await admin.from('inspections').select('*').eq('id', inspection.id).single();
    assert.ok(kept, 'the inspection record was destroyed');
    assert.equal(kept.inspector_name, 'Erased at subject request');
    assert.equal(kept.inspector_id, null);

    const erased = await entries(org.id, { action: 'member.erased', resource_id: subject.profileId });
    assert.equal(erased.length, 1, 'the erasure itself was not recorded');

    const { data: gone } = await admin.auth.admin.getUserById(subject.id);
    assert.equal(gone?.user ?? null, null, 'the login survived erasure');
    delete fixture.users.erase;
  });

  it('is not callable by a signed-in client', async () => {
    const { error } = await fixture.users.admin.client.rpc('erase_subject', {
      p_profile_id: fixture.users.tech.profileId,
    });
    assert.ok(error, 'a client could invoke erasure');
  });

  it('deletes a user who has audit entries', async () => {
    const leaver = await makeUser('leaver', org.id, 'technician');
    await leaver.client.from('inspections').insert({
      organization_id: org.id,
      inspector_id: leaver.profileId,
      equipment_name: 'AUD leaver extinguisher',
      inspector_name: 'AUD leaver',
      status: 'Safe',
    });
    assert.ok((await entries(org.id, { user_id: leaver.id })).length > 0);

    const { error } = await admin.auth.admin.deleteUser(leaver.id);
    assert.equal(error, null, `user deletion failed: ${error?.message}`);
    assert.equal((await entries(org.id, { user_id: leaver.id })).length, 0);
    delete fixture.users.leaver;
  });

  it('deletes an organisation that has audit entries', async () => {
    const doomed = await makeOrg('doomed');
    const member = await makeUser('doomed-admin', doomed.id, 'admin');
    await member.client.from('equipment').insert({ organization_id: doomed.id, name: 'AUD doomed asset' });
    assert.ok((await entries(doomed.id)).length > 0, 'fixture org has no entries');

    await admin.auth.admin.deleteUser(member.id);
    delete fixture.users['doomed-admin'];

    const { error } = await admin.from('organizations').delete().eq('id', doomed.id);
    assert.equal(error, null, `organisation deletion failed: ${error?.message}`);
    assert.equal((await entries(doomed.id)).length, 0);
    fixture.orgs = fixture.orgs.filter((o) => o.id !== doomed.id);
  });
});
