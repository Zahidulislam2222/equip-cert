/// Everything found broken that nobody has fixed yet.
///
/// Grouped by severity rather than by date. A critical defect raised this morning outranks a
/// cosmetic one raised in March, and a date-ordered list buries it — which on fire-safety
/// equipment is the failure mode that matters.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/router.dart';
import '../data/models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_widgets.dart';
import 'home_screen.dart' show openActionsProvider;
import 'inspection_detail_screen.dart' show CorrectiveActionTile;

class CorrectiveActionsScreen extends ConsumerWidget {
  const CorrectiveActionsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppColors c = colorsOf(context);
    final AsyncValue<List<CorrectiveAction>> actions = ref.watch(
      openActionsProvider,
    );

    return Scaffold(
      appBar: AppBar(title: const Text('Corrective actions')),
      body: SafeArea(
        child: RefreshIndicator(
          color: c.primary,
          backgroundColor: c.elevated,
          onRefresh: () async => ref.invalidate(openActionsProvider),
          child: actions.when(
            loading: () => const LoadingState(),
            error: (Object error, StackTrace _) => ListView(
              children: const <Widget>[
                SizedBox(height: 80),
                ErrorState(message: 'Could not load corrective actions.'),
              ],
            ),
            data: (List<CorrectiveAction> all) {
              if (all.isEmpty) {
                return ListView(
                  children: const <Widget>[
                    SizedBox(height: 60),
                    EmptyState(
                      icon: Icons.task_alt_rounded,
                      title: 'Nothing outstanding',
                      message: 'Every defect raised has been resolved.',
                    ),
                  ],
                );
              }

              return ListView(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 40),
                children: <Widget>[
                  for (final String severity in const <String>[
                    'critical',
                    'major',
                    'minor',
                  ])
                    ..._group(
                      context,
                      severity,
                      all.where((CorrectiveAction a) => a.severity == severity),
                    ),

                  // Anything with a severity this build does not recognise still gets
                  // listed. Filtering by a known set and silently dropping the rest would
                  // hide an open defect, which is the one outcome this screen exists to
                  // prevent.
                  ..._group(
                    context,
                    'other',
                    all.where(
                      (CorrectiveAction a) => !const <String>[
                        'critical',
                        'major',
                        'minor',
                      ].contains(a.severity),
                    ),
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }

  List<Widget> _group(
    BuildContext context,
    String severity,
    Iterable<CorrectiveAction> rows,
  ) {
    final List<CorrectiveAction> list = rows.toList(growable: false);
    if (list.isEmpty) return const <Widget>[];

    final AppColors c = colorsOf(context);
    final String title = switch (severity) {
      'critical' => 'Critical',
      'major' => 'Major',
      'minor' => 'Minor',
      _ => 'Other',
    };

    return <Widget>[
      Padding(
        padding: const EdgeInsets.only(top: 8, bottom: 10),
        child: Text(
          '$title (${list.length})',
          style: Theme.of(context).textTheme.titleSmall
              ?.copyWith(color: c.mutedForeground),
        ),
      ),
      for (final CorrectiveAction action in list)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: CorrectiveActionTile(
            action: action,
            // Opens the inspection that produced it. A defect with no context is not
            // actionable — whoever picks it up needs the checklist item, the photo and the
            // location it came from.
            onTap: () =>
                context.go(Routes.inspectionDetail(action.inspectionId)),
          ),
        ),
    ];
  }
}
