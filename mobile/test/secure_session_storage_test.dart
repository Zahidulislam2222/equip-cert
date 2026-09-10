/// Where the Supabase refresh token is kept — acceptance criterion C1.
///
/// ---------------------------------------------------------------------------------------
/// WHY THIS IS THE MOST CONSEQUENTIAL TEST IN THE SUITE
///
/// `supabase_flutter` defaults to `SharedPreferencesLocalStorage`: an XML file on Android, a
/// plist on iOS, neither encrypted by the app. What it holds is not a password — it is the
/// **refresh token**, which mints new access tokens indefinitely. This project runs on the
/// Supabase FREE plan, where `sessions_timebox` and `sessions_inactivity_timeout` are Pro-only,
/// so that refresh token **never expires on its own**.
///
/// A non-expiring credential, in unencrypted storage, on a phone that goes into plant rooms and
/// gets lost. `SecureSessionStorage` is the part of that which can be fixed without a paid
/// plan, and these tests are what stop it being silently un-fixed.
///
/// Two distinct things are checked, because either alone leaves the hole open:
///
///   1. The adapter behaves correctly (round-trip, and every failure degrades to "no session").
///   2. It is actually WIRED IN. A perfect adapter that nobody passes to `Supabase.initialize`
///      leaves the app on the SharedPreferences default while every unit test still passes.
library;

import 'dart:io';

import 'package:equipcert_mobile/src/data/secure_session_storage.dart';
import 'package:flutter/services.dart' show PlatformException;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// An in-memory stand-in for the platform keystore.
///
/// `implements` rather than `extends`, with a `noSuchMethod` so the members this test does not
/// exercise do not have to be hand-written. Anything unexpected that gets called will throw
/// rather than quietly returning null, which is what makes an accidental new dependency on
/// some other API visible instead of silent.
class _FakeSecureStorage implements FlutterSecureStorage {
  final Map<String, String> values = <String, String>{};

  /// When set, every operation throws it — the keystore failure modes that are real: a key
  /// invalidated after the device lock changed, an OS upgrade that rotated the keystore, a
  /// corrupted entry.
  Object? failure;

  int writes = 0;
  int deletes = 0;

  void _maybeFail() {
    final Object? f = failure;
    if (f != null) throw f;
  }

  @override
  Future<String?> read({
    required String key,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    _maybeFail();
    return values[key];
  }

  @override
  Future<void> write({
    required String key,
    required String? value,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    writes++;
    _maybeFail();
    if (value == null) {
      values.remove(key);
    } else {
      values[key] = value;
    }
  }

  @override
  Future<bool> containsKey({
    required String key,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    _maybeFail();
    return values.containsKey(key);
  }

  @override
  Future<void> delete({
    required String key,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    deletes++;
    _maybeFail();
    values.remove(key);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnsupportedError('unexpected call: ${invocation.memberName}');
}

/// A session blob shaped like the one Supabase persists. Deliberately NOT a real token.
const String _sessionBlob =
    '{"access_token":"test-access-token","refresh_token":"test-refresh-token",'
    '"expires_at":1893456000,"token_type":"bearer"}';

void main() {
  late _FakeSecureStorage fake;
  late SecureSessionStorage storage;

  setUp(() {
    fake = _FakeSecureStorage();
    storage = SecureSessionStorage(storage: fake);
  });

  group('it is the adapter Supabase will accept', () {
    test(
      'it is a LocalStorage, or it cannot be passed to Supabase.initialize',
      () {
        // If this stops being true the app silently falls back to the SharedPreferences
        // default, which is the exact thing C1 exists to prevent.
        expect(storage, isA<LocalStorage>());
      },
    );

    test('it is NOT the SharedPreferences implementation', () {
      expect(storage, isNot(isA<SharedPreferencesLocalStorage>()));
    });

    test('initialize does no work and does not throw', () async {
      // FlutterSecureStorage resolves its platform channel lazily. Doing work here would only
      // move a possible failure earlier into startup, before any UI exists to explain it.
      await expectLater(storage.initialize(), completes);
    });
  });

  group('the session round-trips', () {
    test('a persisted session is read back exactly', () async {
      await storage.persistSession(_sessionBlob);

      expect(await storage.accessToken(), _sessionBlob);
    });

    test('hasAccessToken is false before anything is stored', () async {
      expect(await storage.hasAccessToken(), isFalse);
    });

    test('hasAccessToken becomes true once a session is stored', () async {
      await storage.persistSession(_sessionBlob);

      expect(await storage.hasAccessToken(), isTrue);
    });

    test('accessToken is null before anything is stored', () async {
      expect(await storage.accessToken(), isNull);
    });

    test('removing the session clears both reads', () async {
      await storage.persistSession(_sessionBlob);
      await storage.removePersistedSession();

      expect(await storage.accessToken(), isNull);
      expect(await storage.hasAccessToken(), isFalse);
    });

    test('persisting twice overwrites rather than accumulating', () async {
      await storage.persistSession(_sessionBlob);
      await storage.persistSession('{"access_token":"test-second"}');

      expect(await storage.accessToken(), '{"access_token":"test-second"}');
      expect(fake.values.length, 1);
    });
  });

  group('the key is namespaced so nothing else can collide with it', () {
    test(
      'the stored key is the namespaced constant, not a bare name',
      () async {
        await storage.persistSession(_sessionBlob);

        expect(fake.values.keys.single, SecureSessionStorage.sessionKey);
      },
    );

    test('the namespace is application-scoped', () {
      // A key like 'session' in a shared keystore namespace is asking for a collision with a
      // plugin that picked the same obvious name.
      expect(SecureSessionStorage.sessionKey, startsWith('equipcert.'));
      expect(SecureSessionStorage.sessionKey, contains('supabase'));
    });
  });

  group('a keystore failure degrades to "no session", it never throws', () {
    // This is the failure mode that matters. A keystore read can fail for reasons that are not
    // "no session": a key invalidated after the user changed their device lock, an OS upgrade
    // that rotated the keystore, a corrupted entry. An exception on this path takes the app
    // down AT LAUNCH, before any UI exists to explain it. A technician who has to sign in
    // again is a nuisance; an app that will not start is a dead tool.

    test('accessToken returns null instead of rethrowing', () async {
      fake.failure = PlatformException(code: 'keystore-invalidated');

      expect(await storage.accessToken(), isNull);
    });

    test('hasAccessToken returns false instead of rethrowing', () async {
      fake.failure = PlatformException(code: 'keystore-invalidated');

      expect(await storage.hasAccessToken(), isFalse);
    });

    test(
      'a failed read after a good write still degrades, not throws',
      () async {
        await storage.persistSession(_sessionBlob);
        fake.failure = PlatformException(code: 'corrupted-entry');

        expect(await storage.accessToken(), isNull);
        expect(await storage.hasAccessToken(), isFalse);
      },
    );

    test(
      'persistSession swallows the failure — a login is not aborted by it',
      () async {
        // The session works for THIS run regardless; the technician is only asked to sign in
        // again next launch. Throwing here would fail a login that actually succeeded.
        fake.failure = PlatformException(code: 'write-failed');

        await expectLater(storage.persistSession(_sessionBlob), completes);
        expect(
          fake.writes,
          1,
          reason: 'it must still have attempted the write',
        );
      },
    );

    test(
      'removePersistedSession swallows the failure — sign-out never fails',
      () async {
        fake.failure = PlatformException(code: 'delete-failed');

        await expectLater(storage.removePersistedSession(), completes);
        expect(
          fake.deletes,
          1,
          reason: 'it must still have attempted the delete',
        );
      },
    );

    test(
      'a non-platform error is caught too, not just PlatformException',
      () async {
        // `catch (_)` is deliberate breadth. A plugin that throws a bare StateError or a
        // MissingPluginException on an unsupported platform must not take the app down either.
        fake.failure = StateError('something else entirely');

        expect(await storage.accessToken(), isNull);
        expect(await storage.hasAccessToken(), isFalse);
        await expectLater(storage.persistSession(_sessionBlob), completes);
        await expectLater(storage.removePersistedSession(), completes);
      },
    );

    test(
      'recovery: once the keystore works again, the session persists',
      () async {
        fake.failure = PlatformException(code: 'transient');
        await storage.persistSession(_sessionBlob);
        fake.failure = null;

        await storage.persistSession(_sessionBlob);

        expect(await storage.accessToken(), _sessionBlob);
      },
    );
  });

  group('C1: it is actually wired into Supabase.initialize', () {
    // A correct adapter that nobody passes to `Supabase.initialize` leaves the app on the
    // SharedPreferences default while every test above still passes. `Supabase.initialize` is
    // a static that needs a live platform channel, so the wiring is asserted by reading the
    // source that performs it — the same technique `schema_contract_test.dart` uses to check
    // the migrations it cannot execute.
    late String source;

    setUpAll(() {
      final File file = File('lib/src/data/supabase_service.dart');
      expect(
        file.existsSync(),
        isTrue,
        reason: 'lib/src/data/supabase_service.dart is where Supabase.initialize lives',
      );
      source = file.readAsStringSync();
    });

    test('the app calls Supabase.initialize', () {
      expect(source, contains('Supabase.initialize('));
    });

    test('it passes SecureSessionStorage as the localStorage', () {
      expect(
        source,
        contains('localStorage: SecureSessionStorage()'),
        reason: 'without this the refresh token goes to SharedPreferences — C1 fails',
      );
    });

    test('it does not name the SharedPreferences storage anywhere', () {
      expect(source, isNot(contains('SharedPreferencesLocalStorage')));
    });

    test('the session uses PKCE, not the implicit flow', () {
      // The implicit flow returns tokens in a URL fragment, which is recoverable from logs and
      // from the recents screen. PKCE is the only correct choice on a mobile client.
      expect(source, contains('AuthFlowType.pkce'));
    });
  });
}
