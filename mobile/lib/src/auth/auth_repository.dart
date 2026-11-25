import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../data/models.dart';
import '../data/supabase_service.dart';

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
  /// Runs after a confirmed sign-in, never at `auth.signUp()` time: there the caller is still
  /// `anon` and nothing can be created for them (DEF-045).
  ///
  /// Provisioning is ONE server-side transaction, `public.provision_account()` (migration
  /// `20261125000100`). The client used to insert the organisation and the profile itself,
  /// which had two problems: a crash between the two inserts orphaned an organisation, and the
  /// `organizations_insert_during_signup` policy those inserts needed also let ANY signed-in
  /// account create a profile in an existing tenant as its admin (DEF-076). Both policies are
  /// gone; the function reads `org_name` / `full_name` from the caller's own auth metadata,
  /// handles slug collisions, and makes the creator the admin.
  ///
  /// Idempotent and called after every sign-in, so an account stranded by DEF-045 provisions
  /// itself on its next sign-in. An account with no `org_name` is an invited person: it joins
  /// through the invitation link (on the web) and is never minted a tenant of its own here.
  Future<void> ensureProvisioned() async {
    final User? user = currentUser;
    if (user == null) return;

    if (await profileFor(user.id) != null) return;

    final Map<String, dynamic> metadata =
        user.userMetadata ?? const <String, dynamic>{};
    if (_clamp(_string(metadata[orgNameKey])).isEmpty) return;

    await _client.rpc<dynamic>('provision_account');
  }

  static String _string(Object? value) => value is String ? value : '';

  static String _clamp(String value) {
    final String trimmed = value.trim();
    return trimmed.length <= maxNameLength
        ? trimmed
        : trimmed.substring(0, maxNameLength);
  }
}

/// URL-safe organisation slug.
///
/// Since migration `20261125000100` the server (`provision_account`) generates the slug; this
/// function is kept as the client-side statement of the same CHECK contract and is exercised by
/// `test/slug_test.dart`.
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
