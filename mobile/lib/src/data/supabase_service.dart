import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../config/app_config.dart';
import 'secure_session_storage.dart';

/// Supabase initialisation and access.
///
/// The anon key shipped in the binary is public by design — it identifies the project and
/// nothing more. Every row this app can see is decided by **row level security** evaluated
/// against the caller's JWT, server-side. That is why `SUPABASE_SERVICE_ROLE_KEY` must never
/// appear in a `--dart-define`, in an asset, or anywhere else in `mobile/`: it bypasses RLS
/// entirely, and a define is compiled into an APK that anyone can unzip.
class SupabaseService {
  const SupabaseService._();

  /// Call once, before `runApp`.
  ///
  /// Throws [StateError] when configuration is missing rather than initialising against an
  /// empty URL. FAIL CLOSED — the same decision `api/analyze.ts` makes and for the same
  /// reason (DEF-034): a misconfigured build that silently starts is far more dangerous than
  /// one that refuses to, because it looks like it is working.
  static Future<void> initialize() async {
    if (!SupabaseConfig.isConfigured) {
      throw StateError(
        'Supabase is not configured. Build with --dart-define-from-file=dart_define.json; '
        'see mobile/dart_define.example.json for the required keys.',
      );
    }

    await Supabase.initialize(
      url: SupabaseConfig.url,
      // `anonKey:` is deprecated in supabase_flutter 2.17 and removed in the next major.
      // `publishableKey:` is the same slot — the SDK resolves `publishableKey ?? anonKey`
      // into one `effectiveKey` — and it accepts BOTH a legacy `anon` JWT and a new
      // `sb_publishable_...` key, so a project on either key generation works unchanged.
      //
      // The define keeps the name SUPABASE_ANON_KEY because the web target's
      // NEXT_PUBLIC_SUPABASE_ANON_KEY holds the identical value. One deployment, one value,
      // one name: renaming it here would fork the two clients' configuration for nothing.
      publishableKey: SupabaseConfig.anonKey,
      authOptions: FlutterAuthClientOptions(
        // Refresh tokens go to the Keystore / Keychain, not SharedPreferences.
        // See SecureSessionStorage for why that matters more here than usual.
        localStorage: SecureSessionStorage(),
        authFlowType: AuthFlowType.pkce,
      ),
    );
  }

  static SupabaseClient get client => Supabase.instance.client;
}

/// The client, for anything that needs it through the provider graph.
final Provider<SupabaseClient> supabaseClientProvider =
    Provider<SupabaseClient>((ref) => SupabaseService.client);

/// Auth state as a stream, so the router can react to sign-in and sign-out without polling.
final StreamProvider<AuthState> authStateProvider = StreamProvider<AuthState>(
  (ref) => ref.watch(supabaseClientProvider).auth.onAuthStateChange,
);
