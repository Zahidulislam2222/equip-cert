/// `SyncController` — when to drain the offline queue, and when not to.
///
/// Connectivity is a HINT, never proof. `connectivity_plus` reports what the operating system
/// has attached, not whether anything is reachable through it: a captive-portal Wi-Fi, a router
/// with no upstream, and a cell radio showing bars in a basement all report "connected". So the
/// signal decides only WHEN to try; whether it worked is decided by the attempt.
///
/// Two behaviours here are worth more than the rest:
///
///  * **Sync fires on the offline -> online TRANSITION, not on every event.** Android emits
///    connectivity events repeatedly while a radio settles. Syncing on each one starts several
///    overlapping drains.
///  * **Re-entrant drains are refused, not queued.** Two concurrent drains read the same batch
///    and file every inspection in it twice — a duplicate compliance record, which is
///    materially worse than a late one.
///
/// Driving that needs a connectivity source and a queue, so both are substituted:
/// `ConnectivityPlatform.instance` is settable by design, and `offlineQueueProvider` is a
/// Riverpod override.
library;

import 'dart:async';

import 'package:connectivity_plus_platform_interface/connectivity_plus_platform_interface.dart';
import 'package:equipcert_mobile/src/offline/offline_queue.dart';
import 'package:equipcert_mobile/src/offline/sync_service.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';

class _FakeConnectivity extends ConnectivityPlatform
    with MockPlatformInterfaceMixin {
  final StreamController<List<ConnectivityResult>> controller =
      StreamController<List<ConnectivityResult>>.broadcast();

  List<ConnectivityResult> current = <ConnectivityResult>[
    ConnectivityResult.wifi,
  ];

  /// Set when the initial `checkConnectivity` should fail, standing in for a platform-channel
  /// error at startup.
  bool failCheck = false;

  @override
  Future<List<ConnectivityResult>> checkConnectivity() async {
    if (failCheck) throw Exception('platform channel unavailable');
    return current;
  }

  @override
  Stream<List<ConnectivityResult>> get onConnectivityChanged =>
      controller.stream;

  void emit(List<ConnectivityResult> results) {
    current = results;
    controller.add(results);
  }
}

/// A queue that counts what was asked of it.
class _FakeQueue implements OfflineQueue {
  int pending = 0;
  int syncCalls = 0;
  int pendingCountCalls = 0;

  /// Completes each `sync()` only when the test says so, so two drains can be made to overlap.
  Completer<SyncReport>? gate;

  Object? syncFailure;
  Object? pendingFailure;

  SyncReport report = const SyncReport(
    submitted: 2,
    retryable: 0,
    exhausted: 0,
    tampered: 0,
  );

  @override
  Future<int> pendingCount() async {
    pendingCountCalls++;
    final Object? failure = pendingFailure;
    if (failure != null) throw failure;
    return pending;
  }

  @override
  Future<SyncReport> sync() async {
    syncCalls++;
    final Object? failure = syncFailure;
    if (failure != null) throw failure;
    final Completer<SyncReport>? g = gate;
    if (g != null) return g.future;
    return report;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnsupportedError('unexpected call: ${invocation.memberName}');
}

ProviderContainer _container(_FakeQueue queue) {
  final ProviderContainer container = ProviderContainer(
    overrides: [offlineQueueProvider.overrideWithValue(queue)],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  late _FakeConnectivity connectivity;

  setUp(() {
    connectivity = _FakeConnectivity();
    ConnectivityPlatform.instance = connectivity;
  });

  group('SyncState', () {
    test('the defaults assume online', () {
      // Assuming offline would suppress the sync attempt, which is the only real test of
      // reachability there is.
      const SyncState s = SyncState();
      expect(s.online, isTrue);
      expect(s.pending, 0);
      expect(s.syncing, isFalse);
      expect(s.hasPending, isFalse);
      expect(s.lastReport, isNull);
      expect(s.lastSyncedAt, isNull);
    });

    test('hasPending follows the count', () {
      expect(const SyncState(pending: 1).hasPending, isTrue);
      expect(const SyncState(pending: 0).hasPending, isFalse);
    });

    test('copyWith changes only what it is given', () {
      const SyncState base = SyncState(pending: 3, online: false);
      final SyncState next = base.copyWith(syncing: true);
      expect(next.syncing, isTrue);
      expect(next.pending, 3);
      expect(next.online, isFalse);
    });

    test('copyWith can clear the syncing flag', () {
      expect(
        const SyncState(syncing: true).copyWith(syncing: false).syncing,
        isFalse,
      );
    });

    test('copyWith can take a state offline', () {
      expect(const SyncState().copyWith(online: false).online, isFalse);
    });
  });

  group('SyncReport', () {
    test('the empty report did nothing and needs nothing', () {
      expect(SyncReport.empty.didAnything, isFalse);
      expect(SyncReport.empty.needsAttention, isFalse);
    });

    test('a submission counts as having done something', () {
      const SyncReport r = SyncReport(
        submitted: 1,
        retryable: 0,
        exhausted: 0,
        tampered: 0,
      );
      expect(r.didAnything, isTrue);
      expect(r.needsAttention, isFalse);
    });

    test('an exhausted item needs attention', () {
      const SyncReport r = SyncReport(
        submitted: 0,
        retryable: 0,
        exhausted: 1,
        tampered: 0,
      );
      expect(r.needsAttention, isTrue);
    });

    test('a tampered item needs attention', () {
      const SyncReport r = SyncReport(
        submitted: 0,
        retryable: 0,
        exhausted: 0,
        tampered: 1,
      );
      expect(r.needsAttention, isTrue);
    });

    test('a retryable item is not, by itself, cause for attention', () {
      // A retry is the normal state of a queue on a bad connection, not a fault to report.
      const SyncReport r = SyncReport(
        submitted: 0,
        retryable: 3,
        exhausted: 0,
        tampered: 0,
      );
      expect(r.didAnything, isTrue);
      expect(r.needsAttention, isFalse);
    });
  });

  group('startup', () {
    test('it reads the pending count without being asked to sync', () async {
      final _FakeQueue queue = _FakeQueue()..pending = 4;
      final ProviderContainer c = _container(queue);

      c.read(syncProvider);
      await Future<void>.delayed(Duration.zero);

      expect(c.read(syncProvider).pending, 4);
      expect(queue.syncCalls, 0, reason: 'startup must not drain the queue');
    });

    test(
      'a platform-channel failure at startup leaves the app online',
      () async {
        // Assuming offline here would suppress every sync attempt for the session.
        connectivity.failCheck = true;
        final _FakeQueue queue = _FakeQueue();
        final ProviderContainer c = _container(queue);

        c.read(syncProvider);
        await Future<void>.delayed(Duration.zero);

        expect(c.read(syncProvider).online, isTrue);
      },
    );

    test('a queue that cannot be read does not take the app down', () async {
      final _FakeQueue queue = _FakeQueue()
        ..pendingFailure = Exception('db locked');
      final ProviderContainer c = _container(queue);

      c.read(syncProvider);
      await Future<void>.delayed(Duration.zero);

      // Still usable, still online, just without a count.
      expect(c.read(syncProvider).pending, 0);
      expect(c.read(syncProvider).online, isTrue);
    });
  });

  group('connectivity is a hint about WHEN to try', () {
    test('losing every interface marks the app offline', () async {
      final ProviderContainer c = _container(_FakeQueue());
      c.read(syncProvider);
      await Future<void>.delayed(Duration.zero);

      connectivity.emit(<ConnectivityResult>[ConnectivityResult.none]);
      await Future<void>.delayed(Duration.zero);

      expect(c.read(syncProvider).online, isFalse);
    });

    test('any non-none interface counts as online', () async {
      final ProviderContainer c = _container(_FakeQueue());
      c.read(syncProvider);
      await Future<void>.delayed(Duration.zero);

      connectivity.emit(<ConnectivityResult>[ConnectivityResult.none]);
      await Future<void>.delayed(Duration.zero);
      connectivity.emit(<ConnectivityResult>[
        ConnectivityResult.none,
        ConnectivityResult.mobile,
      ]);
      await Future<void>.delayed(Duration.zero);

      expect(c.read(syncProvider).online, isTrue);
    });

    test('coming back online triggers exactly one drain', () async {
      final _FakeQueue queue = _FakeQueue();
      final ProviderContainer c = _container(queue);
      c.read(syncProvider);
      await Future<void>.delayed(Duration.zero);

      connectivity.emit(<ConnectivityResult>[ConnectivityResult.none]);
      await Future<void>.delayed(Duration.zero);
      connectivity.emit(<ConnectivityResult>[ConnectivityResult.wifi]);
      await Future<void>.delayed(Duration.zero);

      expect(queue.syncCalls, 1);
    });

    test('repeated online events do NOT each start a drain', () async {
      // This is the Android radio-settling case. Without the transition check, each event
      // would start an overlapping drain.
      final _FakeQueue queue = _FakeQueue();
      final ProviderContainer c = _container(queue);
      c.read(syncProvider);
      await Future<void>.delayed(Duration.zero);

      for (int i = 0; i < 5; i++) {
        connectivity.emit(<ConnectivityResult>[ConnectivityResult.wifi]);
        await Future<void>.delayed(Duration.zero);
      }

      expect(
        queue.syncCalls,
        0,
        reason: 'no offline -> online transition occurred',
      );
    });

    test('going offline never starts a drain', () async {
      final _FakeQueue queue = _FakeQueue();
      final ProviderContainer c = _container(queue);
      c.read(syncProvider);
      await Future<void>.delayed(Duration.zero);

      connectivity.emit(<ConnectivityResult>[ConnectivityResult.none]);
      await Future<void>.delayed(Duration.zero);

      expect(queue.syncCalls, 0);
    });
  });

  group('sync', () {
    test('a successful drain records the report and the time', () async {
      final _FakeQueue queue = _FakeQueue()..pending = 2;
      final ProviderContainer c = _container(queue);
      c.read(syncProvider);
      await Future<void>.delayed(Duration.zero);

      queue.pending = 0;
      final SyncReport report = await c.read(syncProvider.notifier).sync();

      expect(report.submitted, 2);
      expect(c.read(syncProvider).lastReport?.submitted, 2);
      expect(c.read(syncProvider).lastSyncedAt, isNotNull);
      expect(c.read(syncProvider).syncing, isFalse);
      expect(
        c.read(syncProvider).pending,
        0,
        reason: 'the count is re-read after a drain',
      );
    });

    test('a concurrent drain is refused, not queued', () async {
      // Two drains would read the same batch and file every inspection twice.
      final _FakeQueue queue = _FakeQueue()..gate = Completer<SyncReport>();
      final ProviderContainer c = _container(queue);
      c.read(syncProvider);
      await Future<void>.delayed(Duration.zero);

      final Future<SyncReport> first = c.read(syncProvider.notifier).sync();
      await Future<void>.delayed(Duration.zero);

      final SyncReport second = await c.read(syncProvider.notifier).sync();
      expect(
        second.didAnything,
        isFalse,
        reason: 'the second call returns the empty report immediately',
      );
      expect(queue.syncCalls, 1, reason: 'the queue was drained once');

      queue.gate!.complete(queue.report);
      await first;
    });

    test('the guard releases, so a later drain still runs', () async {
      final _FakeQueue queue = _FakeQueue();
      final ProviderContainer c = _container(queue);
      c.read(syncProvider);
      await Future<void>.delayed(Duration.zero);

      await c.read(syncProvider.notifier).sync();
      await c.read(syncProvider.notifier).sync();

      expect(queue.syncCalls, 2);
    });

    test(
      'a failed drain clears the syncing flag and reports nothing done',
      () async {
        final _FakeQueue queue = _FakeQueue()
          ..syncFailure = Exception('network died mid-drain');
        final ProviderContainer c = _container(queue);
        c.read(syncProvider);
        await Future<void>.delayed(Duration.zero);

        final SyncReport report = await c.read(syncProvider.notifier).sync();

        expect(report.didAnything, isFalse);
        expect(
          c.read(syncProvider).syncing,
          isFalse,
          reason: 'a stuck spinner is the visible symptom of a missed finally',
        );
      },
    );

    test('a failure does not wedge the guard', () async {
      final _FakeQueue queue = _FakeQueue()..syncFailure = Exception('boom');
      final ProviderContainer c = _container(queue);
      c.read(syncProvider);
      await Future<void>.delayed(Duration.zero);

      await c.read(syncProvider.notifier).sync();
      queue.syncFailure = null;
      await c.read(syncProvider.notifier).sync();

      expect(queue.syncCalls, 2, reason: 'the finally must release _draining');
    });
  });
}
