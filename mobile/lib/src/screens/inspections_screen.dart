/// Filed inspections, newest first.
///
/// The list shows what happened and when, not a summary metric. A technician opening this is
/// almost always answering one of two questions: "did the one I just did go through?" and
/// "what did I find on that unit last month?" Both are answered by a chronological list with
/// the outcome visible, which is why there is no dashboard here.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/router.dart';
import '../data/models.dart';
import '../offline/sync_service.dart';
import '../theme/app_theme.dart';
import '../widgets/app_widgets.dart';
import 'home_screen.dart' show formatDateTime, recentInspectionsProvider;

class InspectionsScreen extends ConsumerWidget {
  const InspectionsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<Inspection>> inspections = ref.watch(
      recentInspectionsProvider,
    );
    final SyncState sync = ref.watch(syncProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Inspections')),
      body: SafeArea(
        child: RefreshIndicator(
          color: colorsOf(context).primary,
          backgroundColor: colorsOf(context).elevated,
          onRefresh: () async {
            await ref.read(syncProvider.notifier).sync();
            ref.invalidate(recentInspectionsProvider);
          },
          child: inspections.when(
            loading: () => const LoadingState(),
            error: (Object error, StackTrace _) => ListView(
              children: const <Widget>[
                SizedBox(height: 80),
                ErrorState(
                  message:
                      'Could not load inspections. Pull down to try again.',
                ),
              ],
            ),
            data: (List<Inspection> rows) => ListView(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 40),
              children: <Widget>[
                if (sync.hasPending) ...<Widget>[
                  MessageBanner(
                    // Queued inspections are NOT in this list — the list reads the database,
                    // and they have not reached it. Saying so prevents the reasonable but
                    // wrong conclusion that the work was lost.
                    message:
                        '${sync.pending} inspection${sync.pending == 1 ? '' : 's'} '
                        'still on this phone and not yet filed. '
                        '${sync.pending == 1 ? 'It' : 'They'} will appear here once sent.',
                    tone: BannerTone.info,
                  ),
                  const SizedBox(height: 16),
                ],
                if (rows.isEmpty)
                  const EmptyState(
                    icon: Icons.assignment_outlined,
                    title: 'No inspections yet',
                    message: 'Filed inspections appear here.',
                  )
                else
                  for (final Inspection inspection in rows)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: InspectionTile(inspection: inspection),
                    ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class InspectionTile extends StatelessWidget {
  const InspectionTile({super.key, required this.inspection});

  final Inspection inspection;

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);
    final TextTheme text = Theme.of(context).textTheme;

    final bool safe = inspection.status == InspectionStatus.safe;

    return AppCard(
      onTap: () => context.go(Routes.inspectionDetail(inspection.id)),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  inspection.equipmentName,
                  style: text.titleSmall?.copyWith(color: c.foreground),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 4),
                Text(
                  '${formatDateTime(inspection.createdAt)} · ${inspection.inspectorName}',
                  style: text.bodySmall?.copyWith(color: c.mutedForeground),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (inspection.checklist.isNotEmpty) ...<Widget>[
                  const SizedBox(height: 4),
                  Text(
                    '${inspection.passedCount} passed · ${inspection.failedCount} failed',
                    style: text.bodySmall?.copyWith(color: c.mutedForeground),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: 12),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: <Widget>[
              StatusPill(
                label: safe ? 'Safe' : 'Action required',
                color: safe ? c.success : c.destructive,
                // Never colour alone (WCAG 1.4.1) — the label carries the same fact.
                icon: safe ? Icons.check_rounded : Icons.priority_high_rounded,
              ),
              if (inspection.aiAssisted) ...<Widget>[
                const SizedBox(height: 6),
                Icon(Icons.auto_awesome_rounded, size: 14, color: c.primary),
              ],
            ],
          ),
        ],
      ),
    );
  }
}
