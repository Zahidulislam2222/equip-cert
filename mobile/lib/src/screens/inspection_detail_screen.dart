/// One filed inspection, in full.
///
/// This is the screen an auditor is shown. Everything that makes the record evidence is on it:
/// who inspected, when, against which checklist, what failed, where it happened, the photo,
/// the signature, and — if a model was involved — which one.
///
/// ---------------------------------------------------------------------------------------
/// THE RECORD IS READ-ONLY, AND THAT IS ENFORCED BELOW THIS SCREEN
///
/// There is no edit control here, but the guarantee does not come from its absence. RLS on
/// `inspections` grants no UPDATE and no DELETE to anyone, so a signed record cannot be
/// altered even by an admin with a REST client. A UI that merely hides the button would be a
/// suggestion; the policy is the control.
///
/// ---------------------------------------------------------------------------------------
/// EVIDENCE IS FETCHED THROUGH SIGNED URLS
///
/// The `evidence` bucket is private (DEF-017 was the version where it was not). Nothing here
/// holds a permanent link: paths are exchanged for short-lived signed URLs at view time, and a
/// failure to sign degrades to a placeholder rather than taking the record down.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/evidence_repository.dart';
import '../data/inspection_repository.dart';
import '../data/models.dart';
import '../theme/app_theme.dart';
import '../widgets/ai_disclosure.dart';
import '../widgets/app_widgets.dart';
import 'corrective_action_form.dart';
import 'home_screen.dart' show formatDate, formatDateTime, openActionsProvider;

// `FutureProviderFamily` is not part of `flutter_riverpod`'s public export, so the family
// declarations here rely on inference. The type arguments on `.family<...>` still pin them.
final inspectionByIdProvider = FutureProvider.autoDispose
    .family<Inspection?, int>(
      (Ref ref, int id) => ref.watch(inspectionRepositoryProvider).byId(id),
    );

final actionsForInspectionProvider = FutureProvider.autoDispose
    .family<List<CorrectiveAction>, int>(
      (Ref ref, int id) =>
          ref.watch(inspectionRepositoryProvider).correctiveActionsFor(id),
    );

/// A short-lived URL for one stored object.
///
/// Keyed on the path, so the photo and the signature are signed independently and a failure to
/// sign one does not blank the other.
final signedUrlProvider = FutureProvider.autoDispose.family<String?, String>(
  (Ref ref, String path) =>
      ref.watch(evidenceRepositoryProvider).signedUrl(path),
);

class InspectionDetailScreen extends ConsumerWidget {
  const InspectionDetailScreen({super.key, required this.inspectionId});

  final int inspectionId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<Inspection?> inspection = ref.watch(
      inspectionByIdProvider(inspectionId),
    );

    return Scaffold(
      appBar: AppBar(title: const Text('Inspection record')),
      body: SafeArea(
        child: inspection.when(
          loading: () => const LoadingState(),
          error: (Object error, StackTrace _) => ErrorState(
            message: 'Could not load this inspection.',
            onRetry: () => ref.invalidate(inspectionByIdProvider(inspectionId)),
          ),
          data: (Inspection? record) {
            if (record == null) {
              return const EmptyState(
                icon: Icons.search_off_rounded,
                title: 'Not found',
                // Two causes, one message: the row was purged by the retention job, or RLS
                // scoped it out because it belongs to another organisation. Distinguishing
                // them for the caller would confirm the existence of another tenant's record.
                message: 'This inspection is not available to your account.',
              );
            }
            return _Detail(record: record);
          },
        ),
      ),
    );
  }
}

class _Detail extends ConsumerWidget {
  const _Detail({required this.record});

  final Inspection record;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppColors c = colorsOf(context);
    final TextTheme text = Theme.of(context).textTheme;
    final bool safe = record.status == InspectionStatus.safe;

    final AsyncValue<List<CorrectiveAction>> actions = ref.watch(
      actionsForInspectionProvider(record.id),
    );

    final List<ChecklistEntry> failed = record.checklist
        .where((ChecklistEntry e) => e.status == ChecklistStatus.fail)
        .toList(growable: false);

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 40),
      children: <Widget>[
        Row(
          children: <Widget>[
            Expanded(
              child: Text(
                record.equipmentName,
                style: text.headlineSmall?.copyWith(color: c.foreground),
              ),
            ),
            const SizedBox(width: 12),
            StatusPill(
              label: safe ? 'Safe' : 'Action required',
              color: safe ? c.success : c.destructive,
              icon: safe ? Icons.check_rounded : Icons.priority_high_rounded,
            ),
          ],
        ),
        const SizedBox(height: 16),
        AppCard(
          child: Column(
            children: <Widget>[
              _Fact(label: 'Inspector', value: record.inspectorName),
              _Fact(label: 'Filed', value: formatDateTime(record.createdAt)),
              if (record.locationAddress != null)
                _Fact(label: 'Location', value: record.locationAddress!),
              _Fact(label: 'Record', value: '#${record.id}'),
            ],
          ),
        ),
        if (record.aiAssisted) ...<Widget>[
          const SizedBox(height: 16),
          AppCard(
            child: AiProvenanceNote(
              aiAssisted: record.aiAssisted,
              provider: record.aiProvider,
              model: record.aiModel,
            ),
          ),
        ],
        const SizedBox(height: 24),
        Text(
          'Checklist',
          style: text.titleMedium?.copyWith(color: c.foreground),
        ),
        const SizedBox(height: 10),
        if (record.checklist.isEmpty)
          Text(
            'No checklist was recorded with this inspection.',
            style: text.bodySmall?.copyWith(color: c.mutedForeground),
          )
        else
          for (final ChecklistEntry entry in record.checklist)
            _ChecklistResult(entry: entry),
        const SizedBox(height: 24),
        if (record.photoPath != null) ...<Widget>[
          Text(
            'Photograph',
            style: text.titleMedium?.copyWith(color: c.foreground),
          ),
          const SizedBox(height: 10),
          _Evidence(path: record.photoPath!, height: 220),
          const SizedBox(height: 24),
        ],
        if (record.signaturePath != null) ...<Widget>[
          Text(
            'Signature',
            style: text.titleMedium?.copyWith(color: c.foreground),
          ),
          const SizedBox(height: 10),
          _Evidence(
            path: record.signaturePath!,
            height: 120,
            // The signature is exported as black ink on opaque white. Contained, not cropped:
            // `cover` would cut the ends off a wide signature, and a partial signature on a
            // compliance record is a different signature.
            fit: BoxFit.contain,
          ),
          const SizedBox(height: 24),
        ],
        Text(
          'Corrective actions',
          style: text.titleMedium?.copyWith(color: c.foreground),
        ),
        const SizedBox(height: 10),
        actions.when(
          loading: () => const LoadingState(),
          error: (Object error, StackTrace _) =>
              const ErrorState(message: 'Could not load corrective actions.'),
          data: (List<CorrectiveAction> raised) =>
              _Actions(record: record, failed: failed, raised: raised),
        ),
      ],
    );
  }
}

class _Actions extends ConsumerWidget {
  const _Actions({
    required this.record,
    required this.failed,
    required this.raised,
  });

  final Inspection record;
  final List<ChecklistEntry> failed;
  final List<CorrectiveAction> raised;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppColors c = colorsOf(context);

    // Which failures still have nothing tracking them. This is the path that catches an
    // inspection filed OFFLINE: the queue had no server id at capture time, so no action
    // could be raised then. It can be raised now, from the record.
    final Set<String> covered = raised
        .map((CorrectiveAction a) => a.checklistItemId)
        .whereType<String>()
        .toSet();
    final List<ChecklistEntry> uncovered = failed
        .where((ChecklistEntry e) => !covered.contains(e.id))
        .toList(growable: false);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        if (raised.isEmpty && uncovered.isEmpty)
          const EmptyState(
            icon: Icons.task_alt_rounded,
            title: 'None needed',
            message: 'Nothing failed on this inspection.',
          ),
        for (final CorrectiveAction action in raised)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: CorrectiveActionTile(action: action),
          ),
        if (uncovered.isNotEmpty) ...<Widget>[
          const SizedBox(height: 6),
          MessageBanner(
            message:
                '${uncovered.length} failed item'
                '${uncovered.length == 1 ? ' has' : 's have'} no corrective action yet.',
            tone: BannerTone.warning,
          ),
          const SizedBox(height: 12),
          AppButton(
            label:
                'Raise corrective action'
                '${uncovered.length == 1 ? '' : 's'}',
            icon: Icons.add_task_rounded,
            onPressed: () async {
              await showModalBottomSheet<void>(
                context: context,
                isScrollControlled: true,
                useSafeArea: true,
                builder: (BuildContext context) => CorrectiveActionSheet(
                  inspectionId: record.id,
                  failedItems: uncovered,
                ),
              );
              ref.invalidate(actionsForInspectionProvider(record.id));
              ref.invalidate(openActionsProvider);
            },
          ),
        ],
        if (raised.isNotEmpty && uncovered.isEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              'Every failed item is tracked.',
              style: Theme.of(context).textTheme.bodySmall
                  ?.copyWith(color: c.mutedForeground),
            ),
          ),
      ],
    );
  }
}

/// One corrective action row. Shared with the corrective-actions list.
class CorrectiveActionTile extends StatelessWidget {
  const CorrectiveActionTile({super.key, required this.action, this.onTap});

  final CorrectiveAction action;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);
    final TextTheme text = Theme.of(context).textTheme;

    final Color severityColor = switch (action.severity) {
      'critical' => c.destructive,
      'major' => c.warning,
      _ => c.mutedForeground,
    };

    final bool overdue =
        action.status == 'overdue' ||
        (action.dueDate != null &&
            action.status != 'resolved' &&
            action.dueDate!.isBefore(DateTime.now()));

    return AppCard(
      onTap: onTap,
      borderColor: action.severity == 'critical' ? c.destructive : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  action.description,
                  style: text.bodyMedium?.copyWith(
                    color: c.foreground,
                    height: 1.4,
                  ),
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 12),
              StatusPill(
                label: _severityLabel(action.severity),
                color: severityColor,
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            <String>[
              _statusLabel(action.status),
              if (action.dueDate != null)
                '${overdue ? 'Overdue since' : 'Due'} ${formatDate(action.dueDate!)}',
            ].join(' · '),
            style: text.bodySmall?.copyWith(
              color: overdue ? c.destructive : c.mutedForeground,
            ),
          ),
        ],
      ),
    );
  }

  static String _severityLabel(String severity) => switch (severity) {
    'critical' => 'Critical',
    'major' => 'Major',
    'minor' => 'Minor',
    // A severity this build has not heard of is shown as-is rather than hidden. Silently
    // relabelling an unknown value would misrepresent the record.
    _ => severity,
  };

  static String _statusLabel(String status) => switch (status) {
    'open' => 'Open',
    'in_progress' => 'In progress',
    'resolved' => 'Resolved',
    'overdue' => 'Overdue',
    _ => status,
  };
}

class _ChecklistResult extends StatelessWidget {
  const _ChecklistResult({required this.entry});

  final ChecklistEntry entry;

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);

    final (IconData icon, Color color, String label) = switch (entry.status) {
      ChecklistStatus.pass => (Icons.check_circle_rounded, c.success, 'Passed'),
      ChecklistStatus.fail => (Icons.cancel_rounded, c.destructive, 'Failed'),
      // Should be unreachable on a filed record — submission is blocked while anything is
      // pending. Shown honestly if a record from an older client contains one.
      ChecklistStatus.pending => (
        Icons.help_outline_rounded,
        c.mutedForeground,
        'Not answered',
      ),
    };

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Semantics(
        label: '$label: ${entry.question}',
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            ExcludeSemantics(child: Icon(icon, size: 18, color: color)),
            const SizedBox(width: 12),
            Expanded(
              child: ExcludeSemantics(
                child: Text(
                  entry.question,
                  style: Theme.of(context).textTheme.bodyMedium
                      ?.copyWith(color: c.foreground, height: 1.4),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Evidence extends ConsumerWidget {
  const _Evidence({
    required this.path,
    required this.height,
    this.fit = BoxFit.cover,
  });

  final String path;
  final double height;
  final BoxFit fit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppColors c = colorsOf(context);
    final AsyncValue<String?> url = ref.watch(signedUrlProvider(path));

    Widget frame(Widget child) => ClipRRect(
      borderRadius: AppMetrics.borderRadius,
      child: Container(
        height: height,
        width: double.infinity,
        color: c.elevated,
        alignment: Alignment.center,
        child: child,
      ),
    );

    return url.when(
      loading: () => frame(const LoadingState()),
      error: (Object error, StackTrace _) => frame(
        Text(
          'Evidence unavailable',
          style: Theme.of(context).textTheme.bodySmall
              ?.copyWith(color: c.mutedForeground),
        ),
      ),
      data: (String? signed) {
        if (signed == null) {
          return frame(
            Text(
              'Evidence unavailable',
              style: Theme.of(context).textTheme.bodySmall
                  ?.copyWith(color: c.mutedForeground),
            ),
          );
        }
        return frame(
          Image.network(
            signed,
            height: height,
            width: double.infinity,
            fit: fit,
            // A signed URL that has expired, or a connection that dropped between signing and
            // fetching, must not render a broken-image glyph on a compliance record.
            errorBuilder: (BuildContext context, Object _, StackTrace? _) =>
                Text(
                  'Could not load the image',
                  style: Theme.of(context).textTheme.bodySmall
                      ?.copyWith(color: c.mutedForeground),
                ),
          ),
        );
      },
    );
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
            width: 96,
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
