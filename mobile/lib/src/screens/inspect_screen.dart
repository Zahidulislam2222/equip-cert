/// The technician flow: photograph, analyse, answer, locate, sign, file.
///
/// ---------------------------------------------------------------------------------------
/// THE ORDER IS THE POINT
///
/// Photo first, because it is the only step that must happen while standing in front of the
/// equipment. Everything after it can be completed on the walk back if it has to be. The AI
/// analysis is offered but never required — a technician with no signal, a failed provider or
/// an unreadable label still has to be able to file, and an app that blocks there sends them
/// back to paper.
///
/// ---------------------------------------------------------------------------------------
/// NOTHING HERE MAY LOSE A CAPTURED INSPECTION
///
/// By the time the signature is drawn, this screen holds work that cannot be recreated: the
/// technician has left the plant room. So the submit path has no failure branch that discards
/// it. A network failure enqueues; a rejected insert enqueues; only an explicit "discard" by
/// the person throws it away. That is why [_submit] catches broadly and falls back to the
/// queue rather than surfacing an error with a dead end behind it.
library;

import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/router.dart';
import '../auth/session_controller.dart';
import '../compliance/ai_provenance.dart';
import '../data/analyze_api.dart';
import '../data/capture_service.dart';
import '../data/checklist_repository.dart';
import '../data/evidence_repository.dart';
import '../data/inspection_repository.dart';
import '../data/location_service.dart';
import '../data/models.dart';
import '../offline/offline_queue.dart';
import '../offline/sync_service.dart';
import '../theme/app_theme.dart';
import '../widgets/ai_disclosure.dart';
import '../widgets/app_widgets.dart';
import '../widgets/signature_pad.dart';
import 'corrective_action_form.dart';
import 'home_screen.dart'
    show equipmentDueProvider, openActionsProvider, recentInspectionsProvider;

class InspectScreen extends ConsumerStatefulWidget {
  const InspectScreen({super.key, this.equipmentId, this.aiMode = true});

  /// Set when the flow was started from an equipment row, so the record links to the asset.
  final String? equipmentId;

  /// False when the technician chose the manual path from the capture step.
  final bool aiMode;

  @override
  ConsumerState<InspectScreen> createState() => _InspectScreenState();
}

class _InspectScreenState extends ConsumerState<InspectScreen> {
  final TextEditingController _equipmentName = TextEditingController();
  final TextEditingController _serialNumber = TextEditingController();
  final TextEditingController _notes = TextEditingController();
  final SignaturePadController _signature = SignaturePadController();

  CapturedPhoto? _photo;
  AiProvenance? _provenance;
  List<String> _aiIssues = const <String>[];

  List<ChecklistEntry> _checklist = const <ChecklistEntry>[];
  ChecklistSource _checklistSource = ChecklistSource.fallback;
  bool _checklistLoaded = false;

  LocationFix? _location;
  bool _locating = false;

  Equipment? _equipment;
  bool _started = false;
  bool _analyzing = false;
  bool _submitting = false;
  String? _error;
  String? _notice;

  @override
  void initState() {
    super.initState();
    if (widget.equipmentId != null) {
      // Fire and forget: the flow is usable before it resolves, and a slow lookup must not
      // hold the camera button hostage.
      _loadEquipment(widget.equipmentId!);
    }
  }

  @override
  void dispose() {
    _equipmentName.dispose();
    _serialNumber.dispose();
    _notes.dispose();
    _signature.dispose();
    super.dispose();
  }

  void _loadEquipment(String id) {
    ref
        .read(inspectionRepositoryProvider)
        .equipmentById(id)
        .then((Equipment? equipment) {
          if (!mounted || equipment == null) return;
          setState(() {
            _equipment = equipment;
            if (_equipmentName.text.trim().isEmpty) {
              _equipmentName.text = equipment.name;
            }
            if (_serialNumber.text.trim().isEmpty &&
                equipment.serialNumber != null) {
              _serialNumber.text = equipment.serialNumber!;
            }
          });
          _loadChecklist(equipment.name);
        })
        .catchError((Object _) {
          // A failed lookup is not a failed inspection. The technician types the name instead.
        });
  }

  // -------------------------------------------------------------------------------------
  // Capture

  Future<void> _capture({required bool fromGallery}) async {
    setState(() {
      _error = null;
      _notice = null;
    });

    final CaptureService capture = ref.read(captureServiceProvider);

    final CapturedPhoto? photo;
    try {
      photo = fromGallery
          ? await capture.pickFromGallery()
          : await capture.capture();
    } on UndecodablePhotoException {
      // The picker worked and the file is unreadable — a HEIC whose conversion failed, or a
      // truncated file. Sending them to check a permission that is already granted wastes the
      // visit. DEF-050.
      if (!mounted) return;
      setState(
        () => _error =
            'That image could not be read. It may be corrupt, or in a format this device cannot '
            'convert. Take the photo again, or continue without one.',
      );
      return;
    } catch (_) {
      // Denied camera permission arrives here as a PlatformException. The manual path is
      // still open, and saying so is more useful than naming the exception.
      if (!mounted) return;
      setState(
        () => _error =
            'Could not open the camera. Check the app\'s permissions, or continue without a '
            'photo.',
      );
      return;
    }

    if (photo == null) return; // Cancelled.

    if (!mounted) return;
    setState(() {
      _photo = photo;
      _started = true;
    });

    if (widget.aiMode) await _analyze(photo);
    if (!_checklistLoaded) await _loadChecklist(_equipmentName.text);
  }

  void _startManual() {
    setState(() {
      _started = true;
      _notice =
          'Manual inspection. No photo and no AI analysis will be recorded.';
    });
    _loadChecklist(_equipmentName.text);
  }

  Future<void> _analyze(CapturedPhoto photo) async {
    setState(() => _analyzing = true);

    try {
      final EquipmentAnalysis analysis = await ref
          .read(analyzeApiProvider)
          .analyze(image: photo.bytes, format: photo.format);

      if (!mounted) return;
      setState(() {
        _analyzing = false;
        _provenance = analysis.provenance;
        _aiIssues = analysis.issues;

        // The AI fills the fields in; it does not lock them. Every one stays editable, and
        // the values the technician leaves are what get filed. That is the difference
        // between assisting a qualified inspector and making the determination for them —
        // and it is the basis of the Annex III classification argument.
        if (_equipmentName.text.trim().isEmpty) {
          _equipmentName.text = analysis.equipmentName;
        }
        if (_serialNumber.text.trim().isEmpty) {
          _serialNumber.text = analysis.serialNumber;
        }
      });

      await _loadChecklist(_equipmentName.text);
    } on AnalyzeException catch (error) {
      if (!mounted) return;
      setState(() {
        _analyzing = false;
        // A notice, not an error: nothing has gone wrong with the INSPECTION. The manual
        // path is fully available and the message says so.
        _notice = '${error.message} Fill in the details below yourself.';
      });
      await _loadChecklist(_equipmentName.text);
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _analyzing = false;
        _notice = 'The analysis could not be completed. Fill in the details below yourself.';
      });
      await _loadChecklist(_equipmentName.text);
    }
  }

  Future<void> _loadChecklist(String equipmentName) async {
    final ChecklistResult result = await ref
        .read(checklistRepositoryProvider)
        .forEquipment(equipmentName);

    if (!mounted) return;
    setState(() {
      _checklistLoaded = true;
      _checklistSource = result.source;
      // Answers already given are kept when the checklist is refetched — retyping the
      // equipment name should not silently clear work.
      final Map<String, ChecklistStatus> answered = <String, ChecklistStatus>{
        for (final ChecklistEntry entry in _checklist)
          if (entry.status != ChecklistStatus.pending)
            entry.question: entry.status,
      };
      _checklist = result.entries
          .map(
            (ChecklistEntry entry) => answered.containsKey(entry.question)
                ? entry.copyWith(status: answered[entry.question])
                : entry,
          )
          .toList();
    });
  }

  // -------------------------------------------------------------------------------------
  // Location

  Future<void> _captureLocation() async {
    setState(() => _locating = true);
    final LocationFix fix = await ref.read(locationServiceProvider).current();
    if (!mounted) return;
    setState(() {
      _locating = false;
      _location = fix;
    });
  }

  // -------------------------------------------------------------------------------------
  // Submit

  bool get _pendingItems =>
      _checklist.any((ChecklistEntry e) => e.status == ChecklistStatus.pending);

  String? get _blocker {
    if (_equipmentName.text.trim().isEmpty) return 'Enter what you inspected.';
    if (_checklist.isEmpty) return 'The checklist has not loaded yet.';
    if (_pendingItems) return 'Answer every checklist item.';
    if (_signature.isEmpty) {
      return 'Sign to confirm you carried out this inspection.';
    }
    return null;
  }

  Future<void> _submit() async {
    if (_submitting) return;

    final String? blocker = _blocker;
    if (blocker != null) {
      setState(() => _error = blocker);
      return;
    }

    final AppSession? session = ref.read(sessionProvider).value;
    if (session == null) {
      setState(() => _error = 'Your session expired. Sign in again.');
      return;
    }

    setState(() {
      _submitting = true;
      _error = null;
    });

    final Uint8List? signature = await _signature.toPng();
    final CapturedPhoto? photo = _photo;

    final Map<String, Object?> deviceInfo = <String, Object?>{
      // Recorded because OSHA 1910.157(e) requires the inspection to have been carried out by
      // a qualified person, and the qualification is a property of the person, not the app.
      if (session.profile.qualifications != null)
        'inspector_qualifications': session.profile.qualifications,
      if (_serialNumber.text.trim().isNotEmpty)
        'serial_number': _serialNumber.text.trim(),
      if (_notes.text.trim().isNotEmpty) 'notes': _notes.text.trim(),
      if (_aiIssues.isNotEmpty) 'ai_reported_issues': _aiIssues,
      'checklist_source': _checklistSource.name,
      'client': 'mobile',
    };

    Map<String, Object?> payload({String? photoPath, String? signaturePath}) =>
        buildInspectionInsert(
          organizationId: session.organizationId,
          equipmentName: _equipmentName.text,
          inspectorName: session.inspectorName,
          checklist: _checklist,
          inspectorId: session.profile.id,
          equipmentId: _equipment?.id,
          provenance: _provenance,
          photoPath: photoPath,
          signaturePath: signaturePath,
          location: _location?.point,
          locationAddress: _location?.address,
          deviceInfo: deviceInfo,
        );

    final bool online = ref.read(syncProvider).online;

    if (online) {
      try {
        final EvidenceRepository evidence = ref.read(
          evidenceRepositoryProvider,
        );

        final String? photoPath = photo == null
            ? null
            : await evidence.upload(
                kind: EvidenceKind.inspection,
                organizationId: session.organizationId,
                bytes: photo.bytes,
                format: photo.format,
              );

        final String? signaturePath = signature == null
            ? null
            : await evidence.upload(
                kind: EvidenceKind.signature,
                organizationId: session.organizationId,
                bytes: signature,
                format: EvidenceFormat.png,
              );

        final int id = await ref
            .read(inspectionRepositoryProvider)
            .submit(
              payload(photoPath: photoPath, signaturePath: signaturePath),
            );

        _invalidateLists();
        if (!mounted) return;
        await _finish(inspectionId: id, queued: false);
        return;
      } catch (_) {
        // Deliberately broad, and deliberately NOT an error path. Whatever went wrong —
        // storage, PostgREST, TLS, a captive portal that reported "connected" — the work is
        // still in memory and the queue can hold it. Losing it here is the only unacceptable
        // outcome.
      }
    }

    try {
      await ref
          .read(offlineQueueProvider)
          .enqueue(
            payload: payload(),
            equipmentName: _equipmentName.text.trim(),
            photo: photo?.bytes,
            photoFormat: photo?.format,
            signature: signature,
          );
      await ref.read(syncProvider.notifier).refreshPending();
      if (!mounted) return;
      await _finish(inspectionId: null, queued: true);
    } catch (_) {
      // The local database itself failed. There is nowhere left to put the record, so the
      // screen holds it and says so rather than pretending it was filed.
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error =
            'This inspection could not be saved on the phone. Do not leave this screen '
            '— try again once you have a connection.';
      });
    }
  }

  void _invalidateLists() {
    ref.invalidate(recentInspectionsProvider);
    ref.invalidate(equipmentDueProvider);
    ref.invalidate(openActionsProvider);
  }

  /// Confirm, and offer the corrective actions the failures require.
  ///
  /// This is DEF-043's fix. On the web client the corrective-action form is mounted only when
  /// `submittedInspectionId` is set, inside the same handler that then navigates away — so it
  /// is unreachable and a failed item can never raise an action. Here the id is returned by
  /// `submit`, and the follow-up runs BEFORE this screen is dismissed.
  Future<void> _finish({
    required int? inspectionId,
    required bool queued,
  }) async {
    final List<ChecklistEntry> failed = _checklist
        .where((ChecklistEntry e) => e.status == ChecklistStatus.fail)
        .toList(growable: false);

    if (!mounted) return;

    if (failed.isNotEmpty && inspectionId != null) {
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        builder: (BuildContext context) => CorrectiveActionSheet(
          inspectionId: inspectionId,
          failedItems: failed,
        ),
      );
      _invalidateLists();
    }

    if (!mounted) return;

    final String message = queued
        ? failed.isEmpty
              ? 'Saved on this phone. It will be filed automatically when you have a signal.'
              : 'Saved on this phone. It will be filed when you have a signal — raise the '
                    'corrective actions for the ${failed.length} failed item'
                    '${failed.length == 1 ? '' : 's'} once it has been filed.'
        : 'Inspection filed.';

    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
    context.go(Routes.home);
  }

  // -------------------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Inspection'),
        leading: IconButton(
          icon: const Icon(Icons.close_rounded),
          onPressed: () => _confirmLeave(context),
        ),
      ),
      body: SafeArea(child: _started ? _buildForm(c) : _buildCapture(c)),
    );
  }

  /// Leaving mid-inspection destroys captured work, so it is confirmed — but only once there
  /// is work to destroy.
  Future<void> _confirmLeave(BuildContext context) async {
    if (!_started) {
      context.go(Routes.home);
      return;
    }

    final bool? leave = await showDialog<bool>(
      context: context,
      builder: (BuildContext context) => AlertDialog(
        title: const Text('Discard this inspection?'),
        content: const Text(
          'The photo, the checklist answers and the signature will be lost. Nothing has been '
          'filed yet.',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Keep going'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Discard'),
          ),
        ],
      ),
    );

    if (leave == true && context.mounted) context.go(Routes.home);
  }

  Widget _buildCapture(AppColors c) {
    final TextTheme text = Theme.of(context).textTheme;

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 24, 20, 40),
      children: <Widget>[
        if (_equipment != null) ...<Widget>[
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  _equipment!.name,
                  style: text.titleMedium?.copyWith(color: c.foreground),
                ),
                if (_equipment!.location != null) ...<Widget>[
                  const SizedBox(height: 4),
                  Text(
                    _equipment!.location!,
                    style: text.bodySmall?.copyWith(color: c.mutedForeground),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 20),
        ],
        Text(
          'Photograph the equipment',
          style: text.headlineSmall?.copyWith(color: c.foreground),
        ),
        const SizedBox(height: 8),
        Text(
          'Get the nameplate and the pressure gauge in frame. The photo is stored as evidence '
          'with the record.',
          style: text.bodyMedium?.copyWith(
            color: c.mutedForeground,
            height: 1.5,
          ),
        ),
        const SizedBox(height: 24),
        if (_error != null) ...<Widget>[
          MessageBanner(message: _error!, tone: BannerTone.error),
          const SizedBox(height: 16),
        ],
        AppButton(
          label: 'Take a photo',
          icon: Icons.camera_alt_rounded,
          onPressed: () => _capture(fromGallery: false),
        ),
        const SizedBox(height: 12),
        AppButton(
          label: 'Choose from gallery',
          variant: AppButtonVariant.secondary,
          icon: Icons.photo_library_rounded,
          onPressed: () => _capture(fromGallery: true),
        ),
        const SizedBox(height: 12),
        AppButton(
          label: 'Continue without a photo',
          variant: AppButtonVariant.ghost,
          onPressed: _startManual,
        ),
      ],
    );
  }

  Widget _buildForm(AppColors c) {
    final TextTheme text = Theme.of(context).textTheme;
    final bool offline = !ref.watch(syncProvider).online;

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 48),
      children: <Widget>[
        if (offline) ...<Widget>[
          const MessageBanner(
            message:
                'No connection. This inspection will be saved on the phone and filed '
                'automatically when you have a signal.',
            tone: BannerTone.warning,
          ),
          const SizedBox(height: 16),
        ],
        if (_notice != null) ...<Widget>[
          MessageBanner(message: _notice!, tone: BannerTone.info),
          const SizedBox(height: 16),
        ],
        if (_photo != null) ...<Widget>[
          ClipRRect(
            borderRadius: AppMetrics.borderRadius,
            child: Image.memory(
              _photo!.bytes,
              height: 200,
              width: double.infinity,
              fit: BoxFit.cover,
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  '${_photo!.width}×${_photo!.height} · '
                  '${(_photo!.byteLength / 1024).round()} KB',
                  style: text.bodySmall?.copyWith(color: c.mutedForeground),
                ),
              ),
              AppButton(
                label: 'Retake',
                variant: AppButtonVariant.ghost,
                expand: false,
                onPressed: () => _capture(fromGallery: false),
              ),
            ],
          ),
          const SizedBox(height: 20),
        ],
        if (_analyzing) ...<Widget>[
          const LoadingState(message: 'Analysing the photo'),
          const SizedBox(height: 20),
        ],
        AppTextField(
          label: 'Equipment',
          controller: _equipmentName,
          hint: 'CO2 extinguisher, riser cupboard 3',
          textCapitalization: TextCapitalization.sentences,
        ),
        const SizedBox(height: 14),
        AppTextField(
          label: 'Serial number',
          controller: _serialNumber,
          hint: 'Optional',
          autocorrect: false,
          textCapitalization: TextCapitalization.characters,
        ),
        const SizedBox(height: 24),

        // ART. 50(1): above the checklist, before the answers it influenced. Never
        // dismissible. Renders nothing when no AI ran.
        AiDisclosure(provenance: _provenance),
        if (_provenance != null) const SizedBox(height: 16),

        if (_aiIssues.isNotEmpty) ...<Widget>[
          _AiIssues(issues: _aiIssues),
          const SizedBox(height: 20),
        ],

        Text(
          'Checklist',
          style: text.titleMedium?.copyWith(color: c.foreground),
        ),
        const SizedBox(height: 6),
        Text(switch (_checklistSource) {
          ChecklistSource.contentful => 'Checklist for this equipment type.',
          ChecklistSource.contentfulGeneric => 'No checklist is configured for this equipment type — showing the general one.',
          ChecklistSource.fallback => 'Standard NFPA 10 monthly checks. The configured checklist could not be loaded.',
        }, style: text.bodySmall?.copyWith(color: c.mutedForeground)),
        const SizedBox(height: 12),
        if (!_checklistLoaded)
          const LoadingState(message: 'Loading the checklist')
        else
          for (int i = 0; i < _checklist.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _ChecklistRow(
                entry: _checklist[i],
                onChanged: (ChecklistStatus status) => setState(() {
                  _checklist = List<ChecklistEntry>.from(_checklist)
                    ..[i] = _checklist[i].copyWith(status: status);
                }),
              ),
            ),

        const SizedBox(height: 24),
        _LocationSection(
          fix: _location,
          busy: _locating,
          onCapture: _captureLocation,
        ),

        const SizedBox(height: 24),
        Text(
          'Signature',
          style: text.titleMedium?.copyWith(color: c.foreground),
        ),
        const SizedBox(height: 6),
        Text(
          'By signing you confirm you carried out this inspection. Your name and the time are '
          'recorded with it.',
          style: text.bodySmall?.copyWith(
            color: c.mutedForeground,
            height: 1.4,
          ),
        ),
        const SizedBox(height: 12),
        SignaturePad(controller: _signature),

        const SizedBox(height: 24),
        if (_error != null) ...<Widget>[
          MessageBanner(message: _error!, tone: BannerTone.error),
          const SizedBox(height: 16),
        ],
        AppButton(
          label: offline ? 'Save on this phone' : 'File inspection',
          icon: offline ? Icons.save_rounded : Icons.check_rounded,
          busy: _submitting,
          // Never disabled on an incomplete form. A disabled button with no explanation is
          // the single most common dead end in a field app — the technician taps it, nothing
          // happens, and there is nothing to read. Tapping surfaces the specific blocker.
          onPressed: _submitting ? null : _submit,
        ),
        const SizedBox(height: 10),
        AnimatedBuilder(
          animation: _signature,
          builder: (BuildContext context, Widget? _) {
            final String? blocker = _blocker;
            if (blocker == null) return const SizedBox.shrink();
            return Text(
              blocker,
              textAlign: TextAlign.center,
              style: text.bodySmall?.copyWith(color: c.mutedForeground),
            );
          },
        ),
      ],
    );
  }
}

/// What the model said it saw.
///
/// Presented as claims to verify, not as findings. The heading is the whole design: an
/// unlabelled list of issues reads as the inspection's conclusion, which is the reading Art.
/// 50 exists to prevent and the reading that would make this a high-risk system.
class _AiIssues extends StatelessWidget {
  const _AiIssues({required this.issues});

  final List<String> issues;

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);
    final TextTheme text = Theme.of(context).textTheme;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            'Possible issues to check',
            style: text.titleSmall?.copyWith(color: c.foreground),
          ),
          const SizedBox(height: 10),
          for (final String issue in issues)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Icon(Icons.circle, size: 6, color: c.warning),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      issue,
                      style: text.bodySmall?.copyWith(
                        color: c.mutedForeground,
                        height: 1.4,
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// One checklist item with a pass/fail choice.
///
/// Two full-width buttons rather than a switch or a checkbox. A checkbox has one affirmative
/// state and one ambiguous one — unticked means "failed", "not applicable" or "not yet
/// reached", and on a compliance record those are three different facts. Two explicit choices
/// make "unanswered" visible, which is what the submit guard checks.
class _ChecklistRow extends StatelessWidget {
  const _ChecklistRow({required this.entry, required this.onChanged});

  final ChecklistEntry entry;
  final ValueChanged<ChecklistStatus> onChanged;

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);
    final TextTheme text = Theme.of(context).textTheme;

    final Color borderColor = switch (entry.status) {
      ChecklistStatus.pass => c.success,
      ChecklistStatus.fail => c.destructive,
      ChecklistStatus.pending => c.border,
    };

    return AppCard(
      borderColor: borderColor,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            entry.question,
            style: text.bodyMedium?.copyWith(color: c.foreground, height: 1.4),
          ),
          const SizedBox(height: 12),
          Row(
            children: <Widget>[
              Expanded(
                child: _ChoiceButton(
                  label: 'Pass',
                  icon: Icons.check_rounded,
                  color: c.success,
                  onColor: c.successForeground,
                  selected: entry.status == ChecklistStatus.pass,
                  onPressed: () => onChanged(ChecklistStatus.pass),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _ChoiceButton(
                  label: 'Fail',
                  icon: Icons.close_rounded,
                  color: c.destructive,
                  onColor: c.destructiveForeground,
                  selected: entry.status == ChecklistStatus.fail,
                  onPressed: () => onChanged(ChecklistStatus.fail),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ChoiceButton extends StatelessWidget {
  const _ChoiceButton({
    required this.label,
    required this.icon,
    required this.color,
    required this.onColor,
    required this.selected,
    required this.onPressed,
  });

  final String label;
  final IconData icon;
  final Color color;

  /// The foreground that pairs with [color] when selected. Passed in rather than derived,
  /// because `success` and `destructive` have different paired foregrounds in the palette and
  /// picking one for both would fail contrast on the other.
  final Color onColor;

  final bool selected;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);

    return Semantics(
      selected: selected,
      button: true,
      child: Material(
        color: selected ? color : c.muted,
        borderRadius: BorderRadius.circular(AppMetrics.radiusMd),
        child: InkWell(
          onTap: onPressed,
          borderRadius: BorderRadius.circular(AppMetrics.radiusMd),
          child: Container(
            height: AppMetrics.minTapTarget,
            alignment: Alignment.center,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: <Widget>[
                Icon(
                  icon,
                  size: 18,
                  // Selection is carried by fill AND by the icon, never by colour alone —
                  // WCAG 1.4.1. A red/green pair is exactly the distinction the most common
                  // form of colour blindness removes.
                  color: selected ? onColor : c.mutedForeground,
                ),
                const SizedBox(width: 8),
                Text(
                  label,
                  style: Theme.of(context).textTheme.labelLarge
                      ?.copyWith(color: selected ? onColor : c.mutedForeground),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _LocationSection extends StatelessWidget {
  const _LocationSection({
    required this.fix,
    required this.busy,
    required this.onCapture,
  });

  final LocationFix? fix;
  final bool busy;
  final VoidCallback onCapture;

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);
    final TextTheme text = Theme.of(context).textTheme;

    final String status = switch (fix) {
      null => 'Not recorded yet. Optional.',
      final LocationFix f when f.hasPosition =>
        f.address ?? '${f.point!.lat}, ${f.point!.lng}',
      final LocationFix f when f.denied =>
        'Location permission was declined. The inspection files without it.',
      _ =>
        'No position could be obtained here. The inspection files without it.',
    };

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(
                fix?.hasPosition == true
                    ? Icons.location_on_rounded
                    : Icons.location_searching_rounded,
                size: 18,
                color: fix?.hasPosition == true ? c.success : c.mutedForeground,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Location',
                  style: text.titleSmall?.copyWith(color: c.foreground),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            status,
            style: text.bodySmall?.copyWith(
              color: c.mutedForeground,
              height: 1.4,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            // Stated before the permission dialog rather than after it. A GDPR Art. 5(1)(a)
            // transparency obligation is not met by an OS prompt that says only "allow
            // location".
            'Recording where the inspection took place strengthens the record. It is stored '
            'with the inspection and is visible to your organisation.',
            style: text.bodySmall?.copyWith(
              color: c.mutedForeground,
              height: 1.4,
            ),
          ),
          const SizedBox(height: 12),
          AppButton(
            label: fix?.hasPosition == true
                ? 'Update location'
                : 'Record location',
            variant: AppButtonVariant.secondary,
            icon: Icons.my_location_rounded,
            busy: busy,
            onPressed: busy ? null : onCapture,
          ),
        ],
      ),
    );
  }
}
