import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../data/models.dart';
import '../data/supabase_service.dart';
import '../util/uuid.dart';

/// Authentication and tenant provisioning.
///
/// Ports `src/lib/auth.ts`, with one deliberate divergence: **signup does not create the
/// organisation.** See [ensureProvisioned] and DEF-045.
class AuthRepository {
  AuthRepository(this._client);

  final SupabaseClient _client;

  User? get currentUser => _client.auth.currentUser;
  Session? get currentSession => _client.auth.currentSession;

  /// Metadata keys carried from signup to first confirmed sign-in.
  ///
  /// `raw_user_meta_data` is the one piece of state a caller with no session can write, which
  /// is what makes it the right carrier for the organisation name across the email
  /// confirmation gap. It is user-controlled and therefore NOT trusted for anything that
  /// grants access — it names a tenant the user is about to create and become the sole admin
  /// of, so there is nothing to escalate into.
  static const String fullNameKey = 'full_name';
  static const String orgNameKey = 'org_name';

  /// `organizations.name` and `profiles.full_name` are both `CHECK (length(btrim(x)) BETWEEN
  /// 1 AND 200)`. Trimming to fit is better than letting a long paste come back as an opaque
  /// constraint violation the person cannot act on.
  static const int maxNameLength = 200;

  Future<Profile?> profileFor(String userId) async {
    final Map<String, dynamic>? row = await _client
        .from('profiles')
        .select()
        .eq('user_id', userId)
        .maybeSingle();
    return row == null ? null : Profile.fromJson(row);
  }

  Future<Organization?> organization(String orgId) async {
    final Map<String, dynamic>? row = await _client
        .from('organizations')
        .select()
        .eq('id', orgId)
        .maybeSingle();
    return row == null ? null : Organization.fromJson(row);
  }

  /// Create the auth account only.
  ///
  /// Email confirmation is on (`mailer_autoconfirm: false`), so this returns a user and a
  /// **null session**. Nothing that needs `auth.uid()` may follow it — that is the whole of
  /// DEF-045. The organisation and profile are created by [ensureProvisioned] once the
  /// confirmation link has produced a real session.
  ///
  /// Returns true when a confirmation email is pending, which is the normal outcome.
  Future<bool> signUp({
    required String email,
    required String password,
    required String fullName,
    required String organizationName,
  }) async {
    final AuthResponse response = await _client.auth.signUp(
      email: email,
      password: password,
      data: <String, dynamic>{
        fullNameKey: _clamp(fullName),
        orgNameKey: _clamp(organizationName),
      },
    );

    // A session here would mean auto-confirm got switched on. Provision immediately rather
    // than telling the person to check an inbox that will stay empty.
    if (response.session != null) {
      await ensureProvisioned();
      return false;
    }
    return true;
  }

  Future<void> signIn({required String email, required String password}) async {
    await _client.auth.signInWithPassword(email: email, password: password);
    await ensureProvisioned();
  }

  Future<void> signOut() => _client.auth.signOut();

  Future<void> sendPasswordReset(String email) =>
      _client.auth.resetPasswordForEmail(email);

  /// Make sure the signed-in user has an organisation and a profile.
  ///
  /// ---------------------------------------------------------------------------------------
  /// WHY THIS IS A SEPARATE STEP FROM SIGNUP
  ///
  /// Both inserts below target policies declared `FOR INSERT TO authenticated`. At
  /// `auth.signUp()` time the caller is still `anon` and `auth.uid()` is NULL, so both are
  /// denied — the account is created and the tenant is not, and the person is stranded with an
  /// account they can never use. That is DEF-045, and it is the only path through the web
  /// client's signup today.
  ///
  /// Running here instead means the caller holds a real session, so `auth.uid()` resolves and
  /// `organizations_insert_during_signup` matches its own stated intent: *"a user with no
  /// profile yet is creating the organisation they are about to join."*
  ///
  /// ---------------------------------------------------------------------------------------
  /// NOTHING IS READ BACK — THE ORG ID IS GENERATED HERE
  ///
  /// `organizations.id` has a `gen_random_uuid()` default, so the obvious shape is
  /// `.insert(...).select().single()`. It does not work under RLS. PostgreSQL applies SELECT
  /// policies to a `RETURNING` clause, and `organizations_select_own` matches on
  /// `id = app.current_org_id()` — which reads from `profiles`, which is exactly what does not
  /// exist yet. The row would be inserted and then come back empty.
  ///
  /// Supplying the id removes the read entirely. See [uuidV4].
  ///
  /// ---------------------------------------------------------------------------------------
  /// IT IS IDEMPOTENT, AND THAT IS THE POINT
  ///
  /// Called after every sign-in, not only the first. The early return costs one indexed lookup
  /// on `profiles.user_id` (UNIQUE), and in exchange an account stranded by DEF-045 provisions
  /// itself on its next sign-in — the fix is retroactive, with no migration and no support
  /// ticket.
  ///
  /// The honest limit: if the organisation insert succeeds and the profile insert then fails —
  /// a dropped connection in a plant room, the OS killing the app — the retry creates a SECOND
  /// organisation and the first is orphaned. It is invisible to everyone, including its
  /// creator, because `current_org_id()` reads from `profiles` and no profile references it.
  /// So it is a wasted row, not a wrong one, and clearing it is an owner operation with the
  /// service-role key. Closing that window properly needs both inserts in one transaction,
  /// which means a `SECURITY DEFINER` RPC and a migration — queued, not pretended.
  Future<void> ensureProvisioned() async {
    final User? user = currentUser;
    if (user == null) return;

    if (await profileFor(user.id) != null) return;

    final Map<String, dynamic> metadata =
        user.userMetadata ?? const <String, dynamic>{};
    final String orgName = _clamp(_string(metadata[orgNameKey]));

    // An account created by an admin invite has no org_name — it is joining an EXISTING
    // tenant, and the invite flow writes its profile. Minting a tenant here would silently
    // fork that person off into an empty organisation of their own.
    if (orgName.isEmpty) return;

    // `full_name` is NOT NULL with a 1..200 length check, so an empty value is a constraint
    // violation, not a blank field. The email is the only other identifier guaranteed present.
    final String fullName = switch ((
      _clamp(_string(metadata[fullNameKey])),
      user.email,
    )) {
      (final String name, _) when name.isNotEmpty => name,
      (_, final String? email) when email != null && email.isNotEmpty => _clamp(
        email,
      ),
      _ => 'Account owner',
    };

    final String orgId = uuidV4();
    await _insertOrganization(id: orgId, name: orgName);

    await _client.from('profiles').insert(<String, dynamic>{
      'user_id': user.id,
      'org_id': orgId,
      'full_name': fullName,
      // The creator of a tenant is its admin. Every subsequent member is created by the invite
      // flow, which does not let the invitee choose their own role.
      'role': UserRole.admin.wire,
    });
  }

  /// Insert the organisation, working around the UNIQUE slug.
  ///
  /// `organizations.slug` is UNIQUE, and "Acme Fire Safety" is not a rare company name. The
  /// second one to sign up would otherwise get an opaque `23505` and a dead signup. The retry
  /// appends a random token — this cannot be resolved by reading first, because the caller has
  /// no SELECT visibility on a tenant they do not belong to, so the constraint is the only
  /// thing that can report the collision.
  Future<void> _insertOrganization({
    required String id,
    required String name,
  }) async {
    // `slugify` returns empty when the name has no alphanumeric content — "洪水" or "!!!" are
    // both valid `organizations.name` values (the CHECK there only requires 1..200 non-blank
    // characters) and both slugify to nothing, which the slug CHECK rejects. A generated slug
    // is the only option: the alternative is refusing a legitimate company name.
    final String base = slugify(name);
    for (int attempt = 0; ; attempt++) {
      final String slug = switch (attempt) {
        _ when base.isEmpty => 'org-${shortToken()}',
        0 => base,
        _ => '${_trimSlug(base)}-${shortToken()}',
      };
      try {
        await _client.from('organizations').insert(<String, dynamic>{
          'id': id,
          'name': name,
          'slug': slug,
        });
        return;
      } on PostgrestException catch (error) {
        // 23505 = unique_violation. Anything else — a policy denial, a check constraint, a
        // network failure — is a real error and must surface, not be retried into a loop.
        if (error.code != '23505' || attempt >= 4) rethrow;
      }
    }
  }

  static String _string(Object? value) => value is String ? value : '';

  static String _clamp(String value) {
    final String trimmed = value.trim();
    return trimmed.length <= maxNameLength
        ? trimmed
        : trimmed.substring(0, maxNameLength);
  }

  /// Leave room for `-` plus a 6-character token inside the slug's 63-character ceiling.
  static String _trimSlug(String base) => base.length <= 56
      ? base
      : base.substring(0, 56).replaceAll(RegExp(r'-+$'), '');
}

/// URL-safe organisation slug.
///
/// The column is not merely `TEXT`:
///
/// ```sql
/// slug TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$')
/// ```
///
/// So a slug may not start or end with a hyphen, may not exceed 63 characters, and may not be
/// empty. The web client's version — `name.toLowerCase().replace(/[^a-z0-9]+/g, '-')` — fails
/// that pattern for a great many ordinary names: "Acme Ltd." becomes `acme-ltd-`, and the
/// insert is rejected by the CHECK with no message a user can act on. Trailing punctuation in
/// a company name is the common case, not the edge case.
///
/// This version produces a slug the constraint accepts, or an empty string when the name has
/// no alphanumeric content at all — which the caller must handle rather than send.
String slugify(String name) {
  final String base = name
      .toLowerCase()
      .replaceAll(RegExp('[^a-z0-9]+'), '-')
      .replaceAll(RegExp(r'^-+|-+$'), '');
  if (base.length <= 63) return base;
  return base.substring(0, 63).replaceAll(RegExp(r'-+$'), '');
}

final Provider<AuthRepository> authRepositoryProvider =
    Provider<AuthRepository>(
      (ref) => AuthRepository(ref.watch(supabaseClientProvider)),
    );
