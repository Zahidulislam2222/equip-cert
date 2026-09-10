/// Raising a corrective action for a checklist item that failed.
///
/// ---------------------------------------------------------------------------------------
/// THIS IS THE FIX FOR DEF-043
///
/// On the web client the corrective-action form is rendered only when `submittedInspectionId`
/// is truthy, and that state is set inside the same submit handler that immediately navigates
/// away from the page holding it. The form is therefore unreachable: a failed checklist item
/// can never produce a corrective action, on a product whose entire value is turning findings
/// into tracked remediation.
///
/// The shape that avoids it is structural, not a bug fix. `InspectionRepository.submit`
/// RETURNS the new id, and this sheet is awaited BEFORE the inspection screen is dismissed.
/// There is no window in which the id exists and the form cannot be shown.
///
/// ---------------------------------------------------------------------------------------
/// ONE ACTION PER FAILED ITEM, NOT ONE PER INSPECTION
///
/// `corrective_actions.checklist_item_id` exists so a remediation points at the specific
/// finding it answers. Collapsing three failures into one free-text action loses which one was
/// fixed when it is closed.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/session_controller.dart';
import '../data/capture_service.dart';
import '../data/evidence_repository.dart';
import '../data/inspection_repository.dart';
import '../data/models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_widgets.dart';

/// Severity, matching `CHECK (severity IN ('critical', 'major', 'minor'))`.
///
/// The default is `major`, not `minor`. A checklist item that FAILED on fire-safety equipment
/// is not presumptively trivial, and a default that under-states it is the one a hurried
/// technician accepts.
enum ActionSeverity {
  critical('critical', 'Critical', 'Equipment is unsafe to rely on'),
  major('major', 'Major', 'Needs attention soon'),
  minor('minor', 'Minor', 'Cosmetic or administrative');

  const ActionSeverity(this.wire, this.label, this.description);

  final String wire;
  final String label;
  final String description;
}

class CorrectiveActionSheet extends ConsumerStatefulWidget {
  const CorrectiveActionSheet({
    super.key,
    required this.inspectionId,
    required this.failedItems,
  });

  final int inspectionId;
  final List<ChecklistEntry> failedItems;

  @override
  ConsumerState<CorrectiveActionSheet> createState() =>
      _CorrectiveActionSheetState();
}

class _CorrectiveActionSheetState extends ConsumerState<CorrectiveActionSheet> {
  final Map<String, _ActionDraft> _drafts = <String, _ActionDraft>{};

  @override
  void initState() {
    super.initState();
    for (final ChecklistEntry item in widget.failedItems) {
      _drafts[item.id] = _ActionDraft(
        // Prefilled with the failed question. It is the most accurate description available
        // and it is editable — a blank field at the end of an inspection gets "broken" typed
        // into it, which tells whoever picks the action up nothing.
        description: TextEditingController(text: item.question),
      );
    }
  }

  @override
  void dispose() {
    for (final _ActionDraft draft in _drafts.values) {
      draft.description.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);
    final TextTheme text = Theme.of(context).textTheme;
    final int raised = _drafts.values
        .where((_ActionDraft d) => d.raised)
        .length;

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.9,
      maxChildSize: 0.95,
      builder: (BuildContext context, ScrollController controller) => Container(
        decoration: BoxDecoration(
          color: c.background,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: ListView(
          controller: controller,
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
          children: <Widget>[
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: c.border,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 20),
            Text(
              '${widget.failedItems.length} item'
              '${widget.failedItems.length == 1 ? '' : 's'} failed',
              style: text.headlineSmall?.copyWith(color: c.foreground),
            ),
            const SizedBox(height: 8),
            Text(
              'Raise a corrective action so the defect is tracked to a fix. The inspection is '
              'already filed.',
              style: text.bodyMedium?.copyWith(
                color: c.mutedForeground,
                height: 1.5,
              ),
            ),
            const SizedBox(height: 20),
            for (final ChecklistEntry item in widget.failedItems)
              Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child: _ActionCard(
                  item: item,
                  draft: _drafts[item.id]!,
                  onChanged: () => setState(() {}),
                  onRaise: () => _raise(item),
                ),
              ),
            const SizedBox(height: 8),
            AppButton(
              label: raised == widget.failedItems.length
                  ? 'Done'
                  : 'Finish without the rest',
              variant: raised == widget.failedItems.length
                  ? AppButtonVariant.primary
                  : AppButtonVariant.ghost,
              onPressed: () => Navigator.of(context).pop(),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _raise(ChecklistEntry item) async {
    final _ActionDraft draft = _drafts[item.id]!;
    if (draft.busy || draft.raised) return;

    final AppSession? session = ref.read(sessionProvider).value;
    if (session == null) {
      setState(() => draft.error = 'Your session expired. Sign in again.');
      return;
    }

    if (draft.description.text.trim().isEmpty) {
      setState(() => draft.error = 'Describe what is wrong.');
      return;
    }

    setState(() {
      draft.busy = true;
      draft.error = null;
    });

    try {
      final String? photoPath = draft.photo == null
          ? null
          : await ref
                .read(evidenceRepositoryProvider)
                .upload(
                  kind: EvidenceKind.corrective,
                  organizationId: session.organizationId,
                  bytes: draft.photo!.bytes,
                  format: draft.photo!.format,
                );

      await ref
          .read(inspectionRepositoryProvider)
          .raiseCorrectiveAction(
            buildCorrectiveActionInsert(
              organizationId: session.organizationId,
              inspectionId: widget.inspectionId,
              description: draft.description.text,
              severity: draft.severity.wire,
              checklistItemId: item.id,
              defectPhotoPath: photoPath,
              dueDate: draft.dueDate,
            ),
          );

      if (!mounted) return;
      setState(() {
        draft.busy = false;
        draft.raised = true;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        draft.busy = false;
        // Unlike an inspection, a corrective action has no offline queue: it needs the
        // server-assigned inspection id, which only exists because the inspection was filed
        // ONLINE. Saying it can be raised later from the inspection is accurate, and the
        // detail screen offers exactly that.
        draft.error =
            'Could not raise this action. You can raise it later from the '
            'inspection record.';
      });
    }
  }
}

class _ActionDraft {
  _ActionDraft({required this.description});

  final TextEditingController description;
  ActionSeverity severity = ActionSeverity.major;
  CapturedPhoto? photo;
  DateTime? dueDate;
  bool busy = false;
  bool raised = false;
  String? error;
}

class _ActionCard extends ConsumerWidget {
  const _ActionCard({
    required this.item,
    required this.draft,
    required this.onChanged,
    required this.onRaise,
  });

  final ChecklistEntry item;
  final _ActionDraft draft;
  final VoidCallback onChanged;
  final VoidCallback onRaise;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppColors c = colorsOf(context);
    final TextTheme text = Theme.of(context).textTheme;

    if (draft.raised) {
      return AppCard(
        borderColor: c.success,
        child: Row(
          children: <Widget>[
            Icon(Icons.check_circle_rounded, color: c.success),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                'Action raised — ${draft.severity.label.toLowerCase()}',
                style: text.bodyMedium?.copyWith(color: c.foreground),
              ),
            ),
          ],
        ),
      );
    }

    return AppCard(
      borderColor: c.destructive,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            item.question,
            style: text.titleSmall?.copyWith(color: c.foreground, height: 1.4),
          ),
          const SizedBox(height: 14),
          AppTextField(
            label: 'What is wrong',
            controller: draft.description,
            maxLines: 3,
            textCapitalization: TextCapitalization.sentences,
          ),
          const SizedBox(height: 14),
          Text(
            'Severity',
            style: text.labelLarge?.copyWith(color: c.foreground),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: <Widget>[
              for (final ActionSeverity severity in ActionSeverity.values)
                _SeverityChip(
                  severity: severity,
                  selected: draft.severity == severity,
                  onTap: () {
                    draft.severity = severity;
                    onChanged();
                  },
                ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            draft.severity.description,
            style: text.bodySmall?.copyWith(color: c.mutedForeground),
          ),
          const SizedBox(height: 14),
          Row(
            children: <Widget>[
              Expanded(
                child: AppButton(
                  label: draft.photo == null
                      ? 'Add defect photo'
                      : 'Photo attached',
                  variant: AppButtonVariant.secondary,
                  icon: draft.photo == null
                      ? Icons.add_a_photo_rounded
                      : Icons.check_rounded,
                  onPressed: () async {
                    final CapturedPhoto? photo = await ref
                        .read(captureServiceProvider)
                        .capture();
                    if (photo == null) return;
                    draft.photo = photo;
                    onChanged();
                  },
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          _DueDateRow(draft: draft, onChanged: onChanged),
          if (draft.error != null) ...<Widget>[
            const SizedBox(height: 12),
            MessageBanner(message: draft.error!, tone: BannerTone.error),
          ],
          const SizedBox(height: 14),
          AppButton(
            label: 'Raise corrective action',
            busy: draft.busy,
            onPressed: draft.busy ? null : onRaise,
          ),
        ],
      ),
    );
  }
}

class _SeverityChip extends StatelessWidget {
  const _SeverityChip({
    required this.severity,
    required this.selected,
    required this.onTap,
  });

  final ActionSeverity severity;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);

    final Color fill = switch (severity) {
      ActionSeverity.critical => c.destructive,
      ActionSeverity.major => c.warning,
      ActionSeverity.minor => c.muted,
    };
    final Color on = switch (severity) {
      ActionSeverity.critical => c.destructiveForeground,
      ActionSeverity.major => c.warningForeground,
      ActionSeverity.minor => c.foreground,
    };

    return Semantics(
      selected: selected,
      button: true,
      child: Material(
        color: selected ? fill : c.muted,
        borderRadius: BorderRadius.circular(AppMetrics.radiusSm),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AppMetrics.radiusSm),
          child: Container(
            constraints: const BoxConstraints(
              minHeight: AppMetrics.minTapTarget,
            ),
            padding: const EdgeInsets.symmetric(horizontal: 18),
            alignment: Alignment.center,
            child: Text(
              severity.label,
              style: Theme.of(context).textTheme.labelLarge
                  ?.copyWith(color: selected ? on : c.mutedForeground),
            ),
          ),
        ),
      ),
    );
  }
}

class _DueDateRow extends StatelessWidget {
  const _DueDateRow({required this.draft, required this.onChanged});

  final _ActionDraft draft;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);
    final DateTime today = DateTime.now();

    return Row(
      children: <Widget>[
        Icon(Icons.event_rounded, size: 18, color: c.mutedForeground),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            draft.dueDate == null
                ? 'No due date'
                : 'Due ${draft.dueDate!.toIso8601String().split('T').first}',
            style: Theme.of(context).textTheme.bodySmall
                ?.copyWith(color: c.mutedForeground),
          ),
        ),
        AppButton(
          label: draft.dueDate == null ? 'Set date' : 'Change',
          variant: AppButtonVariant.ghost,
          expand: false,
          onPressed: () async {
            final DateTime? picked = await showDatePicker(
              context: context,
              initialDate: today.add(const Duration(days: 7)),
              // Not before today: `due_date` in the past on a freshly raised action is
              // immediately "overdue", which is noise rather than information.
              firstDate: DateTime(today.year, today.month, today.day),
              lastDate: today.add(const Duration(days: 365 * 2)),
            );
            if (picked == null) return;
            draft.dueDate = picked;
            onChanged();
          },
        ),
      ],
    );
  }
}
