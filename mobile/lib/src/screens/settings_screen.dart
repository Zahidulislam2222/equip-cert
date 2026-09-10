/// Account, the offline queue, and the honest statement of what this build can do.
///
/// ---------------------------------------------------------------------------------------
/// THE QUEUE IS MANAGED HERE, NOT HIDDEN
///
/// A quarantined inspection is a signed compliance record the app has refused to send. Two
/// reasons put it there, and they are not the same:
///
///   * It ran out of retry attempts — a server problem. Retryable.
///   * Its integrity digest did not match — the row was altered after it was signed. NOT
///     retryable, ever, because re-sending altered evidence is precisely what the digest
///     exists to prevent.
///
/// Both are surfaced with the distinction visible. Silently retrying the first forever, or
/// silently dropping the second, would each destroy a record without telling the only person
/// who could act on it.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/session_controller.dart';
import '../config/app_config.dart';
import '../data/models.dart';
import '../offline/offline_queue.dart';
import '../offline/sync_service.dart';
import '../theme/app_theme.dart';
import '../widgets/app_widgets.dart';
import 'home_screen.dart' show formatDateTime;

/// Everything in the local queue, including quarantined rows.
///
/// Distinct from `syncProvider.pending`, which counts only rows still eligible to send. This
/// screen must show the ones that are NOT eligible — they are the reason to come here.
final FutureProvider<List<QueuedInspection>> queuedInspectionsProvider =
    FutureProvider.autoDispose<List<QueuedInspection>>(
      (Ref ref) => ref.watch(offlineQueueProvider).all(),
    );

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppColors c = colorsOf(context);
    final TextTheme text = Theme.of(context).textTheme;
    final AppSession? session = ref.watch(sessionProvider).value;
    final SyncState sync = ref.watch(syncProvider);
    final AsyncValue<List<QueuedInspection>> queued = ref.watch(
      queuedInspectionsProvider,
    );

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 40),
          children: <Widget>[
            if (session != null) ...<Widget>[
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      session.profile.fullName.isEmpty
                          ? 'Unnamed inspector'
                          : session.profile.fullName,
                      style: text.titleMedium?.copyWith(color: c.foreground),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      // The auth email, not a profile column: `profiles` deliberately does
                      // not duplicate it, so erasure has one place to scrub.
                      session.user.email ?? 'No email on file',
                      style: text.bodySmall?.copyWith(color: c.mutedForeground),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: <Widget>[
                        StatusPill(
                          label: _roleLabel(session.profile.role),
                          color: c.primary,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            session.organization.name,
                            style: text.bodySmall?.copyWith(
                              color: c.mutedForeground,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),
            ],

            Text(
              'Offline queue',
              style: text.titleMedium?.copyWith(color: c.foreground),
            ),
            const SizedBox(height: 6),
            Text(
              sync.online
                  ? 'Connected. Queued inspections are sent automatically.'
                  : 'No connection. Inspections are held on this phone until there is one.',
              style: text.bodySmall?.copyWith(color: c.mutedForeground),
            ),
            const SizedBox(height: 12),
            AppButton(
              label: sync.syncing ? 'Sending' : 'Send queued inspections now',
              variant: AppButtonVariant.secondary,
              icon: Icons.cloud_upload_rounded,
              busy: sync.syncing,
              onPressed: sync.syncing
                  ? null
                  : () async {
                      await ref.read(syncProvider.notifier).sync();
                      ref.invalidate(queuedInspectionsProvider);
                    },
            ),
            const SizedBox(height: 14),
            queued.when(
              loading: () => const LoadingState(),
              error: (Object error, StackTrace _) => const ErrorState(
                message: 'Could not read the offline queue on this device.',
              ),
              data: (List<QueuedInspection> rows) {
                if (rows.isEmpty) {
                  return const EmptyState(
                    icon: Icons.cloud_done_rounded,
                    title: 'Nothing waiting',
                    message: 'Every inspection on this phone has been filed.',
                  );
                }
                return Column(
                  children: <Widget>[
                    for (final QueuedInspection row in rows)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: _QueuedTile(row: row),
                      ),
                  ],
                );
              },
            ),

            const SizedBox(height: 28),
            Text(
              'This build',
              style: text.titleMedium?.copyWith(color: c.foreground),
            ),
            const SizedBox(height: 10),
            AppCard(
              child: Column(
                children: <Widget>[
                  _Fact(label: 'App', value: AppInfo.name),
                  _Fact(
                    label: 'AI analysis',
                    // Stated because its absence changes the workflow: with no API origin
                    // compiled in, every inspection is manual. A technician being told the
                    // photo analysis "failed" every time deserves to know it was never
                    // configured.
                    value: AppInfo.apiBaseUrl.isEmpty
                        ? 'Not configured — inspections are manual'
                        : 'Configured',
                  ),
                  _Fact(
                    label: 'Checklists',
                    value: ContentfulConfig.isConfigured
                        ? 'From your content library'
                        : 'NFPA 10 monthly checks (built in)',
                  ),
                ],
              ),
            ),

            const SizedBox(height: 28),
            AppButton(
              label: 'Sign out',
              variant: AppButtonVariant.destructive,
              icon: Icons.logout_rounded,
              onPressed: () => _confirmSignOut(context, ref, sync.pending),
            ),
          ],
        ),
      ),
    );
  }

  static String _roleLabel(UserRole role) => switch (role) {
    UserRole.admin => 'Admin',
    UserRole.manager => 'Manager',
    UserRole.technician => 'Technician',
  };

  /// Signing out with work still on the phone needs a warning.
  ///
  /// The queue is not scoped to a user — it is a local SQLite file — but every queued payload
  /// carries the organisation id it was captured under, and the RLS policy that accepts it is
  /// evaluated against whoever is signed in at SYNC time. Sign out on a shared shift phone,
  /// hand it over, and those inspections are rejected by the server. Warning is the only
  /// honest option; silently dropping them is not.
  static Future<void> _confirmSignOut(
    BuildContext context,
    WidgetRef ref,
    int pending,
  ) async {
    if (pending > 0) {
      final bool? proceed = await showDialog<bool>(
        context: context,
        builder: (BuildContext context) => AlertDialog(
          title: const Text('Inspections not yet filed'),
          content: Text(
            '$pending inspection${pending == 1 ? ' is' : 's are'} still saved on this phone. '
            'Send ${pending == 1 ? 'it' : 'them'} before signing out — after you sign out, '
            '${pending == 1 ? 'it' : 'they'} can only be filed by signing back in as you.',
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Stay signed in'),
            ),
            TextButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Sign out anyway'),
            ),
          ],
        ),
      );
      if (proceed != true) return;
    }

    await ref.read(sessionProvider.notifier).signOut();
  }
}

class _QueuedTile extends ConsumerWidget {
  const _QueuedTile({required this.row});

  final QueuedInspection row;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppColors c = colorsOf(context);
    final TextTheme text = Theme.of(context).textTheme;

    // The two quarantine reasons are distinguished by whether the queue considers the row
    // retryable at all. `OfflineQueue.retry` re-checks the digest and refuses, so offering the
    // button on a tampered row would be a control that silently does nothing.
    final bool tampered =
        row.quarantined &&
        (row.lastError?.startsWith('Integrity check failed') ?? false);

    return AppCard(
      borderColor: row.quarantined ? c.destructive : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  row.equipmentName.isEmpty
                      ? 'Unnamed equipment'
                      : row.equipmentName,
                  style: text.titleSmall?.copyWith(color: c.foreground),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 10),
              StatusPill(
                label: row.quarantined
                    ? (tampered ? 'Blocked' : 'Failed')
                    : 'Waiting',
                color: row.quarantined ? c.destructive : c.warning,
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            'Captured ${formatDateTime(row.capturedAt)}'
            '${row.attempts > 0 ? ' · ${row.attempts} attempt'
                      '${row.attempts == 1 ? '' : 's'}' : ''}',
            style: text.bodySmall?.copyWith(color: c.mutedForeground),
          ),
          if (row.lastError != null) ...<Widget>[
            const SizedBox(height: 8),
            Text(
              row.lastError!,
              style: text.bodySmall?.copyWith(
                color: c.destructive,
                height: 1.4,
              ),
            ),
          ],
          if (row.quarantined) ...<Widget>[
            const SizedBox(height: 12),
            if (tampered)
              Text(
                'This record cannot be sent. Its contents no longer match the signature that '
                'was captured with it, so it is not the inspection that was signed. Redo the '
                'inspection.',
                style: text.bodySmall?.copyWith(
                  color: c.mutedForeground,
                  height: 1.4,
                ),
              )
            else
              AppButton(
                label: 'Try again',
                variant: AppButtonVariant.secondary,
                icon: Icons.refresh_rounded,
                onPressed: () async {
                  await ref.read(offlineQueueProvider).retry(row.id);
                  await ref.read(syncProvider.notifier).sync();
                  ref.invalidate(queuedInspectionsProvider);
                },
              ),
            const SizedBox(height: 8),
            AppButton(
              label: 'Discard this inspection',
              variant: AppButtonVariant.ghost,
              onPressed: () => _confirmDiscard(context, ref),
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _confirmDiscard(BuildContext context, WidgetRef ref) async {
    final bool? discard = await showDialog<bool>(
      context: context,
      builder: (BuildContext context) => AlertDialog(
        title: const Text('Discard this inspection?'),
        content: const Text(
          'The record, its photo and its signature are deleted from this phone permanently. '
          'It has never reached the server, so there is no other copy.',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Keep it'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Discard'),
          ),
        ],
      ),
    );

    if (discard != true) return;
    await ref.read(offlineQueueProvider).discard(row.id);
    await ref.read(syncProvider.notifier).refreshPending();
    ref.invalidate(queuedInspectionsProvider);
  }
}

class _Fact extends StatelessWidget {
  const _Fact({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);
    final TextTheme text = Theme.of(context).textTheme;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          SizedBox(
            width: 110,
            child: Text(
              label,
              style: text.bodySmall?.copyWith(color: c.mutedForeground),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: text.bodyMedium?.copyWith(color: c.foreground),
            ),
          ),
        ],
      ),
    );
  }
}
