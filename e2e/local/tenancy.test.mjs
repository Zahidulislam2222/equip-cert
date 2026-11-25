/**
 * Tenancy, invitations, billing columns and e-sign consent — against the local stack.
 *
 *   DEF-076  a signed-in user with no profile could INSERT a profile into ANY organisation, as admin
 *   DEF-077  an organisation admin could change their own plan / Stripe ids through PostgREST
 *   DEF-074  e-sign consent was never recorded; and a client-chosen timestamp is not evidence
 *   DEF-045  signup left a confirmed account with no organisation (now one atomic RPC)
 *
 * Run: npx supabase start && npm run test:local
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { admin, anonClient, RUN, userWithSession } from './stack.mjs';

const created = { users: [], orgs: [] };

async function orgOf(userId) {
  const { data } = await admin.from('profiles').select('org_id, role').eq('user_id', userId).maybeSingle();
  return data;
}

let owner; // admin of org A, created through the real provisioning path
let ownerOrg;

before(async () => {
  owner = await userWithSession('owner', { full_name: 'Owner Local', org_name: `Acme Local ${RUN}` });
  created.users.push(owner.id);
  const { data, error } = await owner.client.rpc('provision_account');
  assert.equal(error, null, `provision_account failed: ${error?.message}`);
  ownerOrg = data;
  created.orgs.push(ownerOrg);
  // Pro, so the seat limit does not hide the authorisation checks below.
  await admin.from('organizations').update({ plan: 'pro' }).eq('id', ownerOrg);
});

after(async () => {
  for (const id of created.orgs) await admin.from('organizations').delete().eq('id', id);
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
});

describe('provisioning (DEF-045, DEF-076)', () => {
  it('provision_account creates exactly one org with the caller as admin, idempotently', async () => {
    const me = await orgOf(owner.id);
    assert.equal(me.org_id, ownerOrg);
    assert.equal(me.role, 'admin');
    const again = await owner.client.rpc('provision_account');
    assert.equal(again.data, ownerOrg, 'a second call must return the same org, not mint one');
    const { count } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', owner.id);
    assert.equal(count, 1);
  });

  it('a user without a profile cannot insert one into another organisation (DEF-076)', async () => {
    const intruder = await userWithSession('intruder');
    created.users.push(intruder.id);
    const { error } = await intruder.client
      .from('profiles')
      .insert({ user_id: intruder.id, org_id: ownerOrg, full_name: 'Intruder', role: 'admin' });
    assert.notEqual(error, null, 'direct profile insert must be refused');
    assert.equal(await orgOf(intruder.id), null, 'no membership may exist afterwards');
  });

  it('a user cannot insert an organisation directly any more', async () => {
    const solo = await userWithSession('solo');
    created.users.push(solo.id);
    const { error } = await solo.client
      .from('organizations')
      .insert({ id: crypto.randomUUID(), name: 'Direct', slug: `direct-${RUN}` });
    assert.notEqual(error, null);
  });

  it('provision_account without an org name refuses instead of minting an empty tenant', async () => {
    const invitee = await userWithSession('noorg', { full_name: 'No Org' });
    created.users.push(invitee.id);
    const { error } = await invitee.client.rpc('provision_account');
    assert.notEqual(error, null);
    assert.equal(await orgOf(invitee.id), null);
  });

  it('anon cannot call the provisioning functions', async () => {
    const { error } = await anonClient().rpc('provision_account');
    assert.notEqual(error, null);
  });
});

describe('billing columns (DEF-077)', () => {
  it('an admin cannot change their own plan or Stripe ids', async () => {
    for (const patch of [
      { plan: 'enterprise' },
      { stripe_customer_id: 'cus_forged' },
      { stripe_subscription_id: 'sub_forged' },
    ]) {
      const { error } = await owner.client.from('organizations').update(patch).eq('id', ownerOrg);
      assert.notEqual(error, null, `update ${JSON.stringify(patch)} must be refused`);
    }
    const { data } = await admin.from('organizations').select('plan, stripe_customer_id').eq('id', ownerOrg).single();
    assert.equal(data.plan, 'pro');
    assert.equal(data.stripe_customer_id, null);
  });

  it('an admin can still rename the organisation', async () => {
    const { error } = await owner.client.from('organizations').update({ name: `Renamed ${RUN}` }).eq('id', ownerOrg);
    assert.equal(error, null);
  });
});

describe('invitations', () => {
  let token;
  let inviteId;

  it('only an admin can create an invite, and never for the admin role', async () => {
    const { error: adminRole } = await owner.client.rpc('create_invite', { p_role: 'admin', p_valid_hours: 24 });
    assert.notEqual(adminRole, null);
    const { data, error } = await owner.client.rpc('create_invite', { p_role: 'technician', p_valid_hours: 24 });
    assert.equal(error, null, error?.message);
    const row = Array.isArray(data) ? data[0] : data;
    token = row.token;
    inviteId = row.invite_id;
    assert.match(token, /^[A-Za-z0-9_-]{32,}$/);
  });

  it('members can list invites but never read the token hash', async () => {
    const { data, error } = await owner.client.from('organization_invites').select('id, role, expires_at');
    assert.equal(error, null);
    assert.ok(data.some((r) => r.id === inviteId));
    const { error: hashError } = await owner.client.from('organization_invites').select('token_hash');
    assert.notEqual(hashError, null, 'token_hash must not be selectable');
  });

  it('a newcomer joins with the role on the invite, exactly once', async () => {
    const tech = await userWithSession('tech', { full_name: 'Tech Local' });
    created.users.push(tech.id);
    const { data, error } = await tech.client.rpc('accept_invite', { p_token: token });
    assert.equal(error, null, error?.message);
    assert.equal(data, ownerOrg);
    const me = await orgOf(tech.id);
    assert.equal(me.role, 'technician');

    const second = await userWithSession('tech2', { full_name: 'Tech Two' });
    created.users.push(second.id);
    const reuse = await second.client.rpc('accept_invite', { p_token: token });
    assert.notEqual(reuse.error, null, 'an invite is single-use');
    assert.equal(await orgOf(second.id), null);
  });

  it('a technician cannot create invites', async () => {
    const tech = await userWithSession('tech3', { full_name: 'Tech Three' });
    created.users.push(tech.id);
    const { data } = await owner.client.rpc('create_invite', { p_role: 'technician', p_valid_hours: 24 });
    const t = (Array.isArray(data) ? data[0] : data).token;
    await tech.client.rpc('accept_invite', { p_token: t });
    const { error } = await tech.client.rpc('create_invite', { p_role: 'technician', p_valid_hours: 24 });
    assert.notEqual(error, null);
  });

  it('a revoked or unknown token is refused with the same message', async () => {
    const { data } = await owner.client.rpc('create_invite', { p_role: 'manager', p_valid_hours: 24 });
    const row = Array.isArray(data) ? data[0] : data;
    const { error: revokeError } = await owner.client.rpc('revoke_invite', { p_invite_id: row.invite_id });
    assert.equal(revokeError, null);
    const late = await userWithSession('late', { full_name: 'Late' });
    created.users.push(late.id);
    const revoked = await late.client.rpc('accept_invite', { p_token: row.token });
    const unknown = await late.client.rpc('accept_invite', { p_token: 'x'.repeat(32) });
    assert.notEqual(revoked.error, null);
    assert.equal(revoked.error.message, unknown.error.message, 'no oracle between revoked and unknown');
  });

  it('the free plan seat limit is enforced by the database', async () => {
    const solo = await userWithSession('freeowner', { full_name: 'Free', org_name: `Free Org ${RUN}` });
    created.users.push(solo.id);
    const { data: org } = await solo.client.rpc('provision_account');
    created.orgs.push(org);
    const { error } = await solo.client.rpc('create_invite', { p_role: 'technician', p_valid_hours: 24 });
    assert.notEqual(error, null, 'free = 1 user, so no invite may be issued');
  });

  it('the seat limit binds customer sessions, not a service-role support insert', async () => {
    const solo = await userWithSession('freeowner2', { full_name: 'Free 2', org_name: `Free Two ${RUN}` });
    created.users.push(solo.id);
    const { data: org } = await solo.client.rpc('provision_account');
    created.orgs.push(org);
    const extra = await userWithSession('supportadded');
    created.users.push(extra.id);
    const { error } = await admin
      .from('profiles')
      .insert({ user_id: extra.id, org_id: org, full_name: 'Support Added', role: 'technician' });
    assert.equal(error, null, error?.message);
  });
});

describe('e-sign consent evidence (DEF-074)', () => {
  it('record_esign_consent stamps a server time and the wording version', async () => {
    const before = Date.now();
    const { data, error } = await owner.client.rpc('record_esign_consent', { p_version: '2026-10-01' });
    assert.equal(error, null, error?.message);
    const { data: row } = await admin
      .from('profiles')
      .select('esign_consent, esign_consent_at, esign_consent_version')
      .eq('user_id', owner.id)
      .single();
    assert.equal(row.esign_consent, true);
    assert.equal(row.esign_consent_version, '2026-10-01');
    assert.ok(Math.abs(new Date(row.esign_consent_at).getTime() - before) < 60_000);
    assert.ok(data);
  });

  it('a client cannot back-date or forge the consent timestamp', async () => {
    const { error } = await owner.client
      .from('profiles')
      .update({ esign_consent_at: '2000-01-01T00:00:00Z' })
      .eq('user_id', owner.id);
    assert.notEqual(error, null);
  });

  it('consent cannot be withdrawn by editing the profile', async () => {
    const { error } = await owner.client.from('profiles').update({ esign_consent: false }).eq('user_id', owner.id);
    assert.notEqual(error, null);
  });
});

describe('review findings 2026-11-25 (consent is personal, signer must consent, erasure is server-side)', () => {
  /** A member of the owner's organisation, joined through a real invitation. */
  async function member(label) {
    const { data } = await owner.client.rpc('create_invite', { p_role: 'technician', p_valid_hours: 24 });
    const token = (Array.isArray(data) ? data[0] : data).token;
    const user = await userWithSession(label, { full_name: `Member ${label}` });
    created.users.push(user.id);
    const { error } = await user.client.rpc('accept_invite', { p_token: token });
    assert.equal(error, null, error?.message);
    const { data: p } = await admin.from('profiles').select('id').eq('user_id', user.id).single();
    return { ...user, profileId: p.id };
  }

  const signed = (profileId) => ({
    organization_id: ownerOrg,
    inspector_id: profileId,
    inspector_name: 'Local signer',
    equipment_name: `Signed ${RUN}`,
    status: 'Safe',
    signature_url: `${ownerOrg}/signature/${crypto.randomUUID()}.png`,
  });

  it('an admin cannot record e-sign consent on a member’s behalf', async () => {
    const m = await member('consentvictim');
    const { error } = await owner.client
      .from('profiles')
      .update({ esign_consent: true, esign_consent_version: '2026-11-25' })
      .eq('id', m.profileId);
    assert.notEqual(error, null, 'an admin stamped consent for someone else');
    const { data } = await admin.from('profiles').select('esign_consent').eq('id', m.profileId).single();
    assert.equal(data.esign_consent, false);
  });

  it('a member cannot anonymise their own profile to free a seat', async () => {
    const m = await member('selfanon');
    const { error } = await m.client
      .from('profiles')
      .update({ anonymized_at: new Date().toISOString() })
      .eq('id', m.profileId);
    assert.notEqual(error, null, 'a member set anonymized_at on their own row');
  });

  it('a signed inspection is refused until the signer has consented, then accepted', async () => {
    const m = await member('signer');
    const before = await m.client.from('inspections').insert(signed(m.profileId));
    assert.notEqual(before.error, null, 'a signed record was filed with no consent on record');
    const { error: consentError } = await m.client.rpc('record_esign_consent', { p_version: '2026-11-25' });
    assert.equal(consentError, null, consentError?.message);
    const after = await m.client.from('inspections').insert(signed(m.profileId));
    assert.equal(after.error, null, after.error?.message);
  });

  it('a signed inspection cannot name someone else as the inspector', async () => {
    const m = await member('impersonated');
    await owner.client.rpc('record_esign_consent', { p_version: '2026-11-25' });
    const { error } = await owner.client.from('inspections').insert(signed(m.profileId));
    assert.notEqual(error, null, 'the owner filed a signature under a colleague’s name');
  });

  // Review 2: the same rules must hold when the signature is added by an UPDATE.
  async function ownerProfileId() {
    const { data } = await admin.from('profiles').select('id').eq('user_id', owner.id).single();
    return data.id;
  }
  async function unsignedRow(client, inspectorId) {
    const { data, error } = await client
      .from('inspections')
      .insert({ ...signed(inspectorId), signature_url: null })
      .select('id')
      .single();
    assert.equal(error, null, error?.message);
    return data.id;
  }

  it('a manager cannot sign a colleague’s unsigned inspection through an UPDATE', async () => {
    const m = await member('updatesigned');
    await owner.client.rpc('record_esign_consent', { p_version: '2026-11-25' });
    const id = await unsignedRow(owner.client, m.profileId);
    const { error } = await owner.client
      .from('inspections')
      .update({ signature_url: `${ownerOrg}/signature/${crypto.randomUUID()}.png` })
      .eq('id', id);
    assert.notEqual(error, null, 'a manager signed a record in a colleague’s name by UPDATE');
    assert.match(error.message, /inspector who signed it/);
    const { data } = await admin.from('inspections').select('signature_url').eq('id', id).single();
    assert.equal(data.signature_url, null);
  });

  it('signing through an UPDATE is refused on a plan without signatures', async () => {
    await owner.client.rpc('record_esign_consent', { p_version: '2026-11-25' });
    const id = await unsignedRow(owner.client, await ownerProfileId());
    await admin.from('organizations').update({ plan: 'free' }).eq('id', ownerOrg);
    try {
      const { error } = await owner.client
        .from('inspections')
        .update({ signature_url: `${ownerOrg}/signature/${crypto.randomUUID()}.png` })
        .eq('id', id);
      assert.notEqual(error, null, 'a free-plan record was signed by UPDATE');
      assert.match(error.message, /not included in this plan/);
    } finally {
      await admin.from('organizations').update({ plan: 'pro' }).eq('id', ownerOrg);
    }
  });

  it('the signer may still sign their own unsigned record through an UPDATE, with consent', async () => {
    await owner.client.rpc('record_esign_consent', { p_version: '2026-11-25' });
    const id = await unsignedRow(owner.client, await ownerProfileId());
    const { error } = await owner.client
      .from('inspections')
      .update({ signature_url: `${ownerOrg}/signature/${crypto.randomUUID()}.png` })
      .eq('id', id);
    assert.equal(error, null, error?.message);
  });

  it('an unsigned inspection still needs no consent (free-plan path, DEF-079)', async () => {
    const m = await member('unsigned');
    const { error } = await m.client.from('inspections').insert({ ...signed(m.profileId), signature_url: null });
    assert.equal(error, null, error?.message);
  });
});

describe('E2E pass 2026-11-25 (member removal keeps signed records; inspections advance due dates)', () => {
  async function joinedTech(label) {
    const { data } = await owner.client.rpc('create_invite', { p_role: 'technician', p_valid_hours: 24 });
    const u = await userWithSession(label, { full_name: `Tech ${label}` });
    created.users.push(u.id);
    const { error } = await u.client.rpc('accept_invite', { p_token: (Array.isArray(data) ? data[0] : data).token });
    assert.equal(error, null, error?.message);
    const { data: p } = await admin.from('profiles').select('id').eq('user_id', u.id).single();
    return { ...u, profileId: p.id };
  }
  const signedBy = (t) => ({
    organization_id: ownerOrg,
    inspector_id: t.profileId,
    inspector_name: `Tech ${t.label ?? 'x'}`,
    equipment_name: `Removal ${RUN}`,
    status: 'Safe',
    signature_url: `${ownerOrg}/signature/${crypto.randomUUID()}.png`,
  });

  it('DEF-091: an admin can remove a member who signed inspections; the record keeps the name', async () => {
    const t = await joinedTech('leaver');
    assert.equal((await t.client.rpc('record_esign_consent', { p_version: '2026-11-25' })).error, null);
    const { data: ins, error } = await t.client.from('inspections').insert({ ...signedBy(t), inspector_name: 'Tech leaver' }).select('id').single();
    assert.equal(error, null, error?.message);

    const del = await owner.client.from('profiles').delete({ count: 'exact' }).eq('id', t.profileId);
    assert.equal(del.error, null, del.error?.message);
    assert.equal(del.count, 1);

    const { data: row } = await admin.from('inspections').select('inspector_id, inspector_name, signature_url').eq('id', ins.id).single();
    assert.equal(row.inspector_id, null);
    assert.equal(row.inspector_name, 'Tech leaver');
    assert.ok(row.signature_url);
  });

  it('DEF-091: nulling the inspector of a signed record while the profile exists is still refused', async () => {
    const t = await joinedTech('stayer');
    await t.client.rpc('record_esign_consent', { p_version: '2026-11-25' });
    const { data: ins } = await t.client.from('inspections').insert(signedBy(t)).select('id').single();
    // As the organisation's admin (a manager the update policy admits), and asserting the RULE's
    // message: a permission error on the helper function would also be "an error", for the wrong
    // reason (fresh review 2026-11-25).
    const { error } = await owner.client.from('inspections').update({ inspector_id: null }).eq('id', ins.id);
    assert.notEqual(error, null, 'a signed record lost its inspector while the inspector still exists');
    assert.match(error.message, /complete erasure|immutable/i, error.message);
  });

  it('the server sets created_at: a client cannot backdate or postdate a record, or push due dates', async () => {
    const { data: eq } = await admin
      .from('equipment')
      .insert({ organization_id: ownerOrg, name: `Clock ${RUN}`, next_due_date: '2020-01-01' })
      .select('id')
      .single();
    await admin.from('schedules').insert({ organization_id: ownerOrg, equipment_id: eq.id, frequency: 'monthly', next_due: '2020-01-01' });
    const { data: ins, error } = await owner.client
      .from('inspections')
      .insert({ organization_id: ownerOrg, equipment_id: eq.id, equipment_name: `Clock ${RUN}`, inspector_name: 'Owner', status: 'Safe', created_at: '2099-01-01T00:00:00Z' })
      .select('created_at')
      .single();
    assert.equal(error, null, error?.message);
    assert.ok(Math.abs(new Date(ins.created_at) - Date.now()) < 10 * 60e3, `created_at is the server's (got ${ins.created_at})`);
    const { data: e } = await admin.from('equipment').select('next_due_date').eq('id', eq.id).single();
    assert.ok(e.next_due_date < '2030-01-01', `due date not pushed by the client (got ${e.next_due_date})`);
  });

  it('an unsigned inspection cannot be moved onto another organisation’s equipment later', async () => {
    const other = await userWithSession('eqmove', { full_name: 'Other', org_name: `Move ${RUN}` });
    created.users.push(other.id);
    const { data: otherOrg } = await other.client.rpc('provision_account');
    created.orgs.push(otherOrg);
    const { data: theirs } = await admin.from('equipment').insert({ organization_id: otherOrg, name: 'Theirs' }).select('id').single();
    const { data: ins } = await owner.client
      .from('inspections')
      .insert({ organization_id: ownerOrg, equipment_name: 'Unlinked', inspector_name: 'Owner', status: 'Safe' })
      .select('id')
      .single();
    const { error } = await owner.client.from('inspections').update({ equipment_id: theirs.id }).eq('id', ins.id);
    assert.notEqual(error, null, 'an unsigned record was pointed at another tenant’s equipment');
    assert.match(error.message, /does not belong/i, error.message);
  });

  it('DEF-092: an inspection of scheduled equipment advances the schedule and the equipment', async () => {
    const { data: eq } = await admin
      .from('equipment')
      .insert({ organization_id: ownerOrg, name: `Due ${RUN}`, next_due_date: '2020-01-01' })
      .select('id')
      .single();
    await admin.from('schedules').insert([
      { organization_id: ownerOrg, equipment_id: eq.id, frequency: 'monthly', next_due: '2020-01-01' },
      { organization_id: ownerOrg, equipment_id: eq.id, frequency: 'annually', next_due: '2020-01-01' },
    ]);
    const { error } = await owner.client
      .from('inspections')
      .insert({ organization_id: ownerOrg, equipment_id: eq.id, equipment_name: `Due ${RUN}`, inspector_name: 'Owner', status: 'Safe' });
    assert.equal(error, null, error?.message);

    const today = new Date();
    const monthly = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate())).toISOString().slice(0, 10);
    const { data: e } = await admin.from('equipment').select('next_due_date, last_inspection_date').eq('id', eq.id).single();
    assert.ok(e.last_inspection_date, 'last inspection stamped');
    assert.ok(e.next_due_date > '2026-01-01', `next due advanced (got ${e.next_due_date})`);
    const { data: s } = await admin.from('schedules').select('frequency, next_due, last_completed').eq('equipment_id', eq.id).order('frequency');
    const byFreq = Object.fromEntries(s.map((r) => [r.frequency, r]));
    assert.ok(byFreq.monthly.last_completed);
    assert.equal(e.next_due_date, byFreq.monthly.next_due, 'equipment is due at its earliest schedule');
    assert.ok(Math.abs(new Date(byFreq.monthly.next_due) - new Date(monthly)) <= 3 * 86400e3, 'monthly is about a month out');
    assert.ok(byFreq.annually.next_due > byFreq.monthly.next_due);
  });

  it('DEF-092: an inspection cannot name another organisation’s equipment', async () => {
    const other = await userWithSession('eqother', { full_name: 'Other', org_name: `Other ${RUN}` });
    created.users.push(other.id);
    const { data: otherOrg } = await other.client.rpc('provision_account');
    created.orgs.push(otherOrg);
    const { data: eq } = await admin.from('equipment').insert({ organization_id: otherOrg, name: 'Not yours' }).select('id').single();
    const { error } = await owner.client
      .from('inspections')
      .insert({ organization_id: ownerOrg, equipment_id: eq.id, equipment_name: 'Not yours', inspector_name: 'Owner', status: 'Safe' });
    assert.notEqual(error, null, 'filed an inspection against another tenant’s equipment');
    assert.match(error.message, /does not belong/i, error.message);
  });
});
