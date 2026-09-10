/// Drains the offline queue when a connection appears.
///
/// Connectivity is treated as a HINT, never as proof. `connectivity_plus` reports what the
/// operating system has attached — an interface, an SSID, a cellular radio — not whether
/// anything is reachable through it. A plant room with a captive-portal Wi-Fi, a phone
/// connected to a router with no upstream, or a cell radio showing bars in a basement all
/// report "connected" and reach nothing.
///
/// So the signal only decides WHEN to try. Whether the attempt worked is decided by the
/// attempt, and a failure is a retry rather than an error.
library;

import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'offline_queue.dart';

@immutable
class SyncState {
  const SyncState({
    this.pending = 0,
    this.syncing = false,
    this.online = true,
    this.lastReport,
    this.lastSyncedAt,
  });

  final int pending;
  final bool syncing;
  final bool online;
  final SyncReport? lastReport;
  final DateTime? lastSyncedAt;

  bool get hasPending => pending > 0;

  SyncState copyWith({
    int? pending,
    bool? syncing,
    bool? online,
    SyncReport? lastReport,
    DateTime? lastSyncedAt,
  }) => SyncState(
    pending: pending ?? this.pending,
    syncing: syncing ?? this.syncing,
    online: online ?? this.online,
    lastReport: lastReport ?? this.lastReport,
    lastSyncedAt: lastSyncedAt ?? this.lastSyncedAt,
  );
}

class SyncController extends Notifier<SyncState> {
  StreamSubscription<List<ConnectivityResult>>? _subscription;
  bool _draining = false;

  @override
  SyncState build() {
    final Connectivity connectivity = Connectivity();

    _subscription = connectivity.onConnectivityChanged.listen(
      _onConnectivityChanged,
    );
    ref.onDispose(() => _subscription?.cancel());

    // Kick off an initial read without blocking `build`, which must return synchronously.
    unawaited(_initialise(connectivity));

    return const SyncState();
  }

  Future<void> _initialise(Connectivity connectivity) async {
    try {
      _onConnectivityChanged(await connectivity.checkConnectivity());
    } catch (_) {
      // A platform channel failure must not stop the app starting. Assume online: the sync
      // attempt itself is the real test, and assuming offline would suppress it entirely.
      state = state.copyWith(online: true);
    }
    await refreshPending();
  }

  void _onConnectivityChanged(List<ConnectivityResult> results) {
    final bool online = results.any(
      (ConnectivityResult r) => r != ConnectivityResult.none,
    );
    final bool wasOffline = !state.online;

    state = state.copyWith(online: online);

    // Only on the transition. Android emits connectivity events frequently while a radio
    // settles, and syncing on each one would start several overlapping drains.
    if (online && wasOffline) unawaited(sync());
  }

  Future<void> refreshPending() async {
    try {
      state = state.copyWith(
        pending: await ref.read(offlineQueueProvider).pendingCount(),
      );
    } catch (error, stack) {
      // The queue database failing to open is worth knowing about but is not fatal: the app
      // still works online.
      debugPrint('Could not read the offline queue: $error\n$stack');
    }
  }

  /// Attempt one bounded drain.
  ///
  /// Re-entrant calls are ignored rather than queued. Two concurrent drains would both read
  /// the same batch and file every inspection in it twice — a duplicate compliance record,
  /// which is materially worse than a delayed one.
  Future<SyncReport> sync() async {
    if (_draining) return SyncReport.empty;
    _draining = true;
    state = state.copyWith(syncing: true);

    try {
      final SyncReport report = await ref.read(offlineQueueProvider).sync();
      state = state.copyWith(
        syncing: false,
        lastReport: report,
        lastSyncedAt: DateTime.now(),
      );
      await refreshPending();
      return report;
    } catch (error, stack) {
      debugPrint('Offline sync failed: $error\n$stack');
      state = state.copyWith(syncing: false);
      return SyncReport.empty;
    } finally {
      _draining = false;
    }
  }
}

final NotifierProvider<SyncController, SyncState> syncProvider =
    NotifierProvider<SyncController, SyncState>(SyncController.new);
