/// The technician's landing screen.
///
/// It answers three questions in the order a technician actually asks them:
///
///   1. Is anything of mine still stuck on this phone? (the offline queue)
///   2. What needs inspecting today?
///   3. What did I find that somebody still has to fix?
///
/// Everything else is one tap away rather than on this screen. The device is held one-handed,
/// in gloves, often in bad light.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/router.dart';
import '../auth/session_controller.dart';
import '../data/inspection_repository.dart';
import '../data/models.dart';
import '../offline/offline_queue.dart';
import '../offline/sync_service.dart';
import '../theme/app_theme.dart';
import '../widgets/app_widgets.dart';

/// Equipment due for inspection, refetched on demand.
///
/// `autoDispose` matters here: the list is per-organisation, and keeping it alive across a
/// sign-out would show the previous tenant's assets to the next person to sign in on a shared
/// device — which on a shift-issued phone is the normal case, not the edge case.
// The family's own type (`FutureProviderFamily`) is not exported by `flutter_riverpod`, so
// these are the one place in the project where a declaration leans on inference.
final equipmentDueProvider = FutureProvider.autoDispose
    .family<List<Equipment>, int>((Ref ref, int limit) {
      // Depends on the session so that signing in as someone else refetches rather than serving
      // the cached list.
      ref.watch(organizationIdProvider);
      return ref.watch(inspectionRepositoryProvider).equipmentDue(limit: limit);
    });

final FutureProvider<List<CorrectiveAction>> openActionsProvider =
    FutureProvider.autoDispose<List<CorrectiveAction>>((Ref ref) {
      ref.watch(organizationIdProvider);
      return ref.watch(inspectionRepositoryProvider).openCorrectiveActions();
    });

final FutureProvider<List<Inspection>> recentInspectionsProvider =
    FutureProvider.autoDispose<List<Inspection>>((Ref ref) {
      ref.watch(organizationIdProvider);
      return ref.watch(inspectionRepositoryProvider).recent(limit: 20);
    });

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppColors c = colorsOf(context);
    final AppSession? session = ref.watch(sessionProvider).value;
    final SyncState sync = ref.watch(syncProvider);

    // The redirect guard guarantees a session on this route; this frame only happens during
    // sign-out, while the router is already moving away.
    if (session == null) return const Scaffold(body: LoadingState());

    final AsyncValue<List<Equipment>> due = ref.watch(equipmentDueProvider(20));
    final AsyncValue<List<CorrectiveAction>> actions = ref.watch(
      openActionsProvider,
    );

    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          color: c.primary,
          backgroundColor: c.elevated,
          onRefresh: () async {
            // The queue first. A technician pulling to refresh after walking back into signal
            // is asking "did my work go through", not "reload the asset list".
            await ref.read(syncProvider.notifier).sync();
            ref.invalidate(equipmentDueProvider);
            ref.invalidate(openActionsProvider);
            ref.invalidate(recentInspectionsProvider);
          },
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 40),
            children: <Widget>[
              _Greeting(session: session),
              const SizedBox(height: 20),
              if (sync.hasPending ||
                  sync.lastReport?.needsAttention == true) ...<Widget>[
                _SyncBanner(state: sync),
                const SizedBox(height: 16),
              ],
              _StartInspectionCard(onTap: () => context.go(Routes.inspect)),
              const SizedBox(height: 24),
              _SectionHeader(
                title: 'Due for inspection',
                actionLabel: 'All equipment',
                onAction: () => context.go(Routes.equipment),
              ),
              const SizedBox(height: 10),
              _DueList(due: due),
              const SizedBox(height: 24),
              _SectionHeader(
                title: 'Open corrective actions',
                actionLabel: 'View all',
                onAction: () => context.go(Routes.corrective),
              ),
              const SizedBox(height: 10),
              _ActionsSummary(actions: actions),
              const SizedBox(height: 24),
              _NavRow(
                icon: Icons.history_rounded,
                label: 'Inspection history',
                onTap: () => context.go(Routes.inspections),
              ),
              _NavRow(
                icon: Icons.settings_rounded,
                label: 'Settings',
                onTap: () => context.go(Routes.settings),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Greeting extends StatelessWidget {
  const _Greeting({required this.session});

  final AppSession session;

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);
    final TextTheme text = Theme.of(context).textTheme;

    return Row(
      children: <Widget>[
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                // `firstName` is empty-safe on a blank name; the fallback keeps the sentence
                // grammatical rather than rendering "Hello ,".
                session.profile.firstName.isEmpty
                    ? 'Welcome back'
                    : 'Hello, ${session.profile.firstName}',
                style: text.headlineSmall?.copyWith(color: c.foreground),
              ),
              const SizedBox(height: 4),
              Text(
                session.organization.name,
                style: text.bodySmall?.copyWith(color: c.mutedForeground),
              ),
            ],
          ),
        ),
        const BrandMark(size: 40, showWordmark: false),
      ],
    );
  }
}

/// The state of the offline queue, in the technician's terms.
///
/// Deliberately prominent. Work that has not reached the server is not filed, and the person
/// who did it is the only one who can decide whether to walk back into signal — but only if
/// they are told.
class _SyncBanner extends ConsumerWidget {
  const _SyncBanner({required this.state});

  final SyncState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final SyncReport? report = state.lastReport;

    if (report != null && report.needsAttention) {
      final String message = report.tampered > 0
          ? 'A queued inspection failed its integrity check and was not sent. Open Settings '
                'to review it.'
          : 'An inspection could not be filed after several attempts. Open Settings to '
                'retry or review it.';

      return MessageBanner(
        message: message,
        tone: BannerTone.error,
        action: AppButton(
          label: 'Review',
          variant: AppButtonVariant.ghost,
          expand: false,
          onPressed: () => context.go(Routes.settings),
        ),
      );
    }

    return MessageBanner(
      message: state.online
          ? '${state.pending} inspection${state.pending == 1 ? '' : 's'} waiting to be filed.'
          : 'No connection. ${state.pending} inspection${state.pending == 1 ? '' : 's'} '
                'saved on this phone and will be filed automatically.',
      tone: state.online ? BannerTone.info : BannerTone.warning,
      action: state.online
          ? AppButton(
              label: state.syncing ? 'Sending' : 'Send now',
              variant: AppButtonVariant.ghost,
              expand: false,
              busy: state.syncing,
              onPressed: state.syncing
                  ? null
                  : () => ref.read(syncProvider.notifier).sync(),
            )
          : null,
    );
  }
}

/// The primary call to action.
///
/// One card, the full width of the screen, well above the fold. Starting an inspection is what
/// this app is for; anything that makes it compete for attention with navigation is wrong.
class _StartInspectionCard extends StatelessWidget {
  const _StartInspectionCard({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);
    final TextTheme text = Theme.of(context).textTheme;

    return Material(
      color: c.primary,
      borderRadius: AppMetrics.borderRadius,
      child: InkWell(
        onTap: onTap,
        borderRadius: AppMetrics.borderRadius,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 22),
          child: Row(
            children: <Widget>[
              Icon(
                Icons.camera_alt_rounded,
                color: c.primaryForeground,
                size: 28,
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      'Start an inspection',
                      style: text.titleMedium?.copyWith(
                        color: c.primaryForeground,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Photograph the equipment and work the checklist',
                      style: text.bodySmall?.copyWith(
                        // Not `mutedForeground`: that token is tuned for the dark surface and
                        // is close to unreadable on Safety Yellow. Derived from the button's
                        // own foreground instead, which is guaranteed to contrast with it.
                        color: c.primaryForeground.withValues(alpha: 0.75),
                      ),
                    ),
                  ],
                ),
              ),
              Icon(Icons.arrow_forward_rounded, color: c.primaryForeground),
            ],
          ),
        ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, this.actionLabel, this.onAction});

  final String title;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);

    return Row(
      children: <Widget>[
        Expanded(
          child: Text(
            title,
            style: Theme.of(context).textTheme.titleMedium
                ?.copyWith(color: c.foreground),
          ),
        ),
        if (actionLabel != null && onAction != null)
          AppButton(
            label: actionLabel!,
            variant: AppButtonVariant.ghost,
            expand: false,
            onPressed: onAction,
          ),
      ],
    );
  }
}

class _DueList extends StatelessWidget {
  const _DueList({required this.due});

  final AsyncValue<List<Equipment>> due;

  @override
  Widget build(BuildContext context) {
    return due.when(
      loading: () => const LoadingState(),
      error: (Object error, StackTrace _) => const ErrorState(
        message: 'Could not load the equipment list. Pull down to try again.',
      ),
      data: (List<Equipment> all) {
        final List<Equipment> relevant = all
            .where(
              (Equipment e) =>
                  e.isOverdue || e.isDueToday || e.nextDueDate != null,
            )
            .take(5)
            .toList(growable: false);

        if (relevant.isEmpty) {
          return const EmptyState(
            icon: Icons.check_circle_outline_rounded,
            title: 'Nothing scheduled',
            message: 'No equipment has an inspection date set.',
          );
        }

        return Column(
          children: <Widget>[
            for (final Equipment equipment in relevant)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: EquipmentTile(equipment: equipment),
              ),
          ],
        );
      },
    );
  }
}

/// One asset row. Shared with the equipment list, so the two cannot describe the same asset
/// differently.
class EquipmentTile extends StatelessWidget {
  const EquipmentTile({super.key, required this.equipment});

  final Equipment equipment;

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);
    final TextTheme text = Theme.of(context).textTheme;

    final (String label, Color color) = switch (equipment) {
      final Equipment e when e.isOverdue => ('Overdue', c.destructive),
      final Equipment e when e.isDueToday => ('Due today', c.warning),
      _ => ('Scheduled', c.mutedForeground),
    };

    return AppCard(
      onTap: () => context.go('${Routes.inspect}?equipmentId=${equipment.id}'),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  equipment.name,
                  style: text.titleSmall?.copyWith(color: c.foreground),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 4),
                Text(
                  <String?>[
                    equipment.location,
                    if (equipment.nextDueDate != null)
                      'Due ${formatDate(equipment.nextDueDate!)}',
                  ].whereType<String>().join(' · '),
                  style: text.bodySmall?.copyWith(color: c.mutedForeground),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          StatusPill(label: label, color: color),
        ],
      ),
    );
  }
}

class _ActionsSummary extends StatelessWidget {
  const _ActionsSummary({required this.actions});

  final AsyncValue<List<CorrectiveAction>> actions;

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);

    return actions.when(
      loading: () => const LoadingState(),
      error: (Object error, StackTrace _) =>
          const ErrorState(message: 'Could not load corrective actions.'),
      data: (List<CorrectiveAction> all) {
        if (all.isEmpty) {
          return const EmptyState(
            icon: Icons.task_alt_rounded,
            title: 'Nothing outstanding',
            message: 'Every defect raised has been resolved.',
          );
        }

        final int critical = all
            .where((CorrectiveAction a) => a.severity == 'critical')
            .length;

        return AppCard(
          onTap: () => context.go(Routes.corrective),
          borderColor: critical > 0 ? c.destructive : null,
          child: Row(
            children: <Widget>[
              Icon(
                critical > 0
                    ? Icons.error_outline_rounded
                    : Icons.build_circle_outlined,
                color: critical > 0 ? c.destructive : c.warning,
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Text(
                  critical > 0
                      ? '${all.length} open · $critical critical'
                      : '${all.length} open',
                  style: Theme.of(context).textTheme.titleSmall
                      ?.copyWith(color: c.foreground),
                ),
              ),
              Icon(Icons.chevron_right_rounded, color: c.mutedForeground),
            ],
          ),
        );
      },
    );
  }
}

class _NavRow extends StatelessWidget {
  const _NavRow({required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppMetrics.radiusMd),
        child: Container(
          // Not a fixed height: at a large system text scale a fixed row clips its own label.
          constraints: const BoxConstraints(minHeight: AppMetrics.minTapTarget),
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 12),
          child: Row(
            children: <Widget>[
              Icon(icon, size: 20, color: c.mutedForeground),
              const SizedBox(width: 14),
              Expanded(
                child: Text(
                  label,
                  style: Theme.of(context).textTheme.bodyLarge
                      ?.copyWith(color: c.foreground),
                ),
              ),
              Icon(Icons.chevron_right_rounded, color: c.mutedForeground),
            ],
          ),
        ),
      ),
    );
  }
}

/// `2026-09-10` — ISO order, no locale.
///
/// Deliberately not `DateFormat.yMd()`: this is a compliance app used across regions, and
/// `03/04/2026` is two different days depending on who reads it. The `intl` dependency is also
/// avoided outright, since one shared formatter here cannot drift from another one there.
String formatDate(DateTime date) {
  final String month = date.month.toString().padLeft(2, '0');
  final String day = date.day.toString().padLeft(2, '0');
  return '${date.year}-$month-$day';
}

String formatDateTime(DateTime value) {
  final String hour = value.hour.toString().padLeft(2, '0');
  final String minute = value.minute.toString().padLeft(2, '0');
  return '${formatDate(value)} $hour:$minute';
}
