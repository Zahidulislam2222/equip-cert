import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Persists the Supabase session in the platform keystore instead of SharedPreferences.
///
/// ---------------------------------------------------------------------------------------
/// WHY THIS EXISTS
///
/// `supabase_flutter` defaults to [SharedPreferencesLocalStorage]. On Android that is a
/// world-readable-to-the-app XML file at
/// `/data/data/<pkg>/shared_prefs/`, and on iOS it is `NSUserDefaults` — a plist in the app
/// container. Neither is encrypted at rest by the app, and both are readable on a rooted or
/// jailbroken device, from an unencrypted local backup, or by anything that gets filesystem
/// access to the container.
///
/// What is stored there is not a password — it is the **refresh token**, which is worse. A
/// refresh token mints new access tokens indefinitely, and this project runs on the Supabase
/// FREE plan where `sessions_timebox` and `sessions_inactivity_timeout` are Pro-only
/// features. That means a free-tier refresh token **never expires on its own**. A copy taken
/// off a lost phone stays valid until someone notices and revokes it by hand.
///
/// That combination — a non-expiring credential in unencrypted storage, on a device that goes
/// into plant rooms and gets lost — is the most material authentication weakness in this
/// project. It is recorded as such in `memory/RESUME.md`. This class is the part of it that
/// can be fixed without a paid plan.
///
/// [FlutterSecureStorage] puts the value behind the **Android Keystore** (via an
/// `EncryptedSharedPreferences`-backed implementation) and the **iOS Keychain**. The key
/// material is held by hardware-backed storage where the device has it, so the ciphertext is
/// useless off-device even with full filesystem access.
///
/// ---------------------------------------------------------------------------------------
/// WHAT THIS DOES **NOT** PROTECT AGAINST
///
/// Stated plainly so nobody reads more into it than is true:
///
///   * A rooted device with an active session and a hooked process. Keystore protects data at
///     rest, not a live app being instrumented by something running as root.
///   * A compromised OS or a malicious keyboard capturing the password at entry.
///   * Server-side revocation. If a phone is lost, the token still has to be revoked; this
///     only makes it hard to *extract*. Revocation is an owner action in the Supabase
///     dashboard until session timeboxing is available.
///
/// ---------------------------------------------------------------------------------------
/// THE FAILURE MODE THAT MATTERS
///
/// Keystore reads can fail for reasons that are not "no session": a key invalidated after the
/// user changed their device lock, an OS upgrade that rotated the keystore, a corrupted
/// entry. Every method here degrades to "no session" rather than throwing, because an
/// exception on this path takes the whole app down at launch — before any UI exists to
/// explain it. A technician who has to sign in again is a nuisance; an app that will not
/// start is a dead tool.
class SecureSessionStorage extends LocalStorage {
  SecureSessionStorage({FlutterSecureStorage? storage})
    : _storage =
          storage ??
          const FlutterSecureStorage(
            aOptions: AndroidOptions(
              // v11 defaults are already the strong path — AES/GCM/NoPadding for the data,
              // RSA-OAEP-SHA256 to wrap the key, key held in the Android Keystore. They are
              // named explicitly rather than left implicit so a future package default
              // cannot silently weaken this without the diff showing it.
              //
              // (The `encryptedSharedPreferences: true` flag that appears in every
              // pre-v10 example no longer exists; encryption is not opt-in any more.)
              storageCipherAlgorithm: StorageCipherAlgorithm.AES_GCM_NoPadding,
              keyCipherAlgorithm:
                  KeyCipherAlgorithm.RSA_ECB_OAEPwithSHA_256andMGF1Padding,
              // Biometrics are NOT required. The session has to be readable by a background
              // sync of queued offline inspections, which has no user present to prompt.
              enforceBiometrics: false,
              // A keystore entry can be invalidated by an OS upgrade or a lock-screen
              // change. Resetting beats throwing at launch: the technician signs in again.
              resetOnError: true,
            ),
            iOptions: IOSOptions(
              // `first_unlock_this_device`: readable after the first unlock following a
              // boot, and NEVER synced to iCloud Keychain or migrated to a restored device.
              //
              // `first_unlock` (without `_this_device`) would let the token ride a backup
              // onto a different phone. `when_unlocked` would be stricter still, but it
              // makes the token unreadable while the screen is locked — which breaks
              // background sync of queued offline inspections, the one feature that has to
              // work when the phone is in a pocket.
              accessibility: KeychainAccessibility.first_unlock_this_device,
            ),
          );

  final FlutterSecureStorage _storage;

  /// Namespaced so it cannot collide with anything else this app stores.
  static const String sessionKey = 'equipcert.supabase.session';

  @override
  Future<void> initialize() async {
    // Nothing to open. FlutterSecureStorage resolves its platform channel lazily, so doing
    // work here would only move a possible failure earlier in startup for no benefit.
  }

  @override
  Future<bool> hasAccessToken() async {
    try {
      return await _storage.containsKey(key: sessionKey);
    } catch (_) {
      return false;
    }
  }

  @override
  Future<String?> accessToken() async {
    try {
      return await _storage.read(key: sessionKey);
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> persistSession(String persistSessionString) async {
    try {
      await _storage.write(key: sessionKey, value: persistSessionString);
    } catch (_) {
      // A session that could not be persisted still works for this run; the technician is
      // simply asked to sign in again next launch. Throwing here would abort a successful
      // login, which is strictly worse.
    }
  }

  @override
  Future<void> removePersistedSession() async {
    try {
      await _storage.delete(key: sessionKey);
    } catch (_) {
      // Sign-out must never fail. If the delete did not land, the in-memory session is gone
      // regardless and the stale entry is overwritten by the next successful login.
    }
  }
}
