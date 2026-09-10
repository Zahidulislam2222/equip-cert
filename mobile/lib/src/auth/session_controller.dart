/// The signed-in identity: auth user + profile + organisation, resolved once.
///
/// ---------------------------------------------------------------------------------------
/// WHY ALL THREE TRAVEL TOGETHER
///
/// Almost nothing in this app can be done with only an auth user. Every table is scoped by
/// `organization_id`, evidence object paths start with the organisation id, and the inspector
/// of record is `profiles.full_name`. A screen holding a `User` but no `Profile` can render a
/// greeting and nothing else.
///
/// Worse, resolving them separately invites the failure where a screen reads
/// `profile.orgId` before the profile has loaded and files an inspection under an empty
/// organisation — which is not a validation error, it is an evidence object written to a path
/// no storage policy matches (DEF-017's shape). So [AppSession] is either complete or absent.
///
/// ---------------------------------------------------------------------------------------
/// THIS IS ALSO WHERE DEF-045 SELF-HEALS
///
/// An account created by the web client's broken signup has an auth user and no profile,
/// permanently. [SessionController.build] calls [AuthRepository.ensureProvisioned] whenever
/// the profile is missing, so such an account repairs itself the first time it opens this app
/// — not only when it signs in through this app's own form. See DEF-045.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:meta/meta.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../data/models.dart';
import '../data/supabase_service.dart';
import 'auth_repository.dart';

/// A complete, usable identity.
@immutable
class AppSession {
  const AppSession({
    required this.user,
    required this.profile,
    required this.organization,
  });

  final User user;
  final Profile profile;
  final Organization organization;

  String get organizationId => organization.id;

  /// The name that goes on the inspection record.
  ///
  /// Always the human. NFPA 10 and OSHA 1910.157(e) both require the inspection to have been
  /// performed by a qualified person, so naming a model here would put a machine on a safety
  /// document as the responsible inspector. AI involvement is recorded in the `ai_*` columns,
  /// which is where it belongs.
  String get inspectorName => profile.fullName;
}

/// Just the id of whoever is signed in, or null.
///
/// `onAuthStateChange` fires on every token refresh, which on this project is often — free-tier
/// refresh tokens never expire on their own, so the SDK refreshes on a timer for the life of
/// the install. Selecting the id means the session is re-resolved when the PERSON changes and
/// not when a token rotates, which would otherwise refetch the profile and organisation every
/// hour for no reason.
final Provider<String?> currentUserIdProvider = Provider<String?>((Ref ref) {
  final AsyncValue<String?> fromStream = ref.watch(
    authStateProvider.select(
      (AsyncValue<AuthState> value) =>
          value.whenData((AuthState state) => state.session?.user.id),
    ),
  );

  // Before the stream has emitted, the SDK has already restored any persisted session
  // synchronously. Falling back to it stops the app flashing the login screen on every cold
  // start for a user who is signed in.
  return fromStream.value ??
      ref.watch(supabaseClientProvider).auth.currentUser?.id;
});

class SessionController extends AsyncNotifier<AppSession?> {
  @override
  Future<AppSession?> build() async {
    final String? userId = ref.watch(currentUserIdProvider);
    if (userId == null) return null;

    final AuthRepository auth = ref.watch(authRepositoryProvider);
    final User? user = auth.currentUser;
    if (user == null) return null;

    Profile? profile = await auth.profileFor(userId);

    if (profile == null) {
      // DEF-045: an account stranded with no tenant. Provisioning is idempotent and this
      // caller holds a real session, so it succeeds where signup could not.
      await auth.ensureProvisioned();
      profile = await auth.profileFor(userId);
    }

    if (profile == null) {
      // Reachable and legitimate: an invited user whose profile the inviting admin has not
      // created yet has no `org_name` in their metadata, so `ensureProvisioned` deliberately
      // declines to mint them a tenant of their own. Returning null lands them on the gate
      // with an explanation instead of a half-built app shell.
      return null;
    }

    final Organization? organization = await auth.organization(profile.orgId);
    if (organization == null) return null;

    return AppSession(user: user, profile: profile, organization: organization);
  }

  /// Re-resolve after something that changes the identity — provisioning, a profile edit.
  Future<void> refresh() async {
    state = const AsyncValue<AppSession?>.loading();
    state = await AsyncValue.guard(build);
  }

  /// Sign out and clear the secure session.
  ///
  /// The state is cleared BEFORE awaiting the network call. `signOut()` reaches the server to
  /// revoke the refresh token, and on the plant-room connection this app is built for that can
  /// hang — leaving the technician looking at their data after asking to leave. Locally the
  /// session is gone either way; the revocation is best-effort.
  Future<void> signOut() async {
    state = const AsyncValue<AppSession?>.data(null);
    await ref.read(authRepositoryProvider).signOut();
  }
}

final AsyncNotifierProvider<SessionController, AppSession?> sessionProvider =
    AsyncNotifierProvider<SessionController, AppSession?>(
      SessionController.new,
    );

/// The organisation id, for the many callers that need only that.
///
/// Throws rather than returning empty when there is no session. An empty organisation id
/// silently produces an evidence path with a leading slash, which no storage policy matches
/// and which fails as an opaque 400 at upload time — far from the code that lost the id.
final Provider<String?> organizationIdProvider = Provider<String?>(
  (Ref ref) => ref.watch(sessionProvider).value?.organizationId,
);
