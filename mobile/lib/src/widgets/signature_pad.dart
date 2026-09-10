/// The signature pad, and the PNG it produces.
///
/// ---------------------------------------------------------------------------------------
/// WHAT A SIGNATURE IS DOING ON THIS RECORD
///
/// NFPA 10 and OSHA 1910.157(e) both require an inspection to have been performed by a
/// qualified person, and the record to say who. The signature is the technician's
/// attestation, so two properties matter more than how it looks:
///
///   1. It cannot be submitted empty. A blank canvas rendered to PNG is a perfectly valid
///      image file, so "did the widget produce bytes" is NOT the check — [isEmpty] asks
///      whether anyone actually drew.
///   2. It is rendered at a fixed pixel size regardless of the screen it was drawn on, so a
///      signature captured on a small phone and one captured on a tablet produce comparable
///      evidence.
library;

import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import 'app_widgets.dart';

/// One continuous pen-down..pen-up stroke.
///
/// Public because [SignaturePadController.strokes] exposes it — the painter and the PNG
/// export both read the same list, and a private type behind a public getter is a type nobody
/// outside this file can name.
class SignatureStroke {
  SignatureStroke(this.points);

  final List<Offset> points;
}

class SignaturePadController extends ChangeNotifier {
  final List<SignatureStroke> _strokes = <SignatureStroke>[];
  SignatureStroke? _active;
  Size _canvasSize = Size.zero;

  List<SignatureStroke> get strokes => <SignatureStroke>[..._strokes, ?_active];

  /// True until something is actually drawn.
  ///
  /// A single tap counts. A technician who taps once has made a mark and intends it as their
  /// signature; second-guessing that would be the app refusing a valid attestation.
  bool get isEmpty => _strokes.isEmpty && _active == null;

  bool get isNotEmpty => !isEmpty;

  void begin(Offset point, Size canvasSize) {
    _canvasSize = canvasSize;
    _active = SignatureStroke(<Offset>[point]);
    notifyListeners();
  }

  void extend(Offset point) {
    final SignatureStroke? active = _active;
    if (active == null) return;
    active.points.add(point);
    notifyListeners();
  }

  void end() {
    final SignatureStroke? active = _active;
    if (active != null) _strokes.add(active);
    _active = null;
    notifyListeners();
  }

  void clear() {
    _strokes.clear();
    _active = null;
    notifyListeners();
  }

  /// Render to PNG bytes, or null if nothing was drawn.
  ///
  /// ---------------------------------------------------------------------------------------
  /// BLACK INK ON WHITE, NOT THE APP'S THEME
  ///
  /// The pad displays in the app's dark palette, but the EXPORT is deliberately black on
  /// white. This image is evidence: it gets embedded in PDF reports, printed, and read by
  /// people who never saw the app. A pale-yellow signature on a near-black background is
  /// illegible on paper and disappears entirely on a monochrome printer.
  ///
  /// The background is painted OPAQUE white rather than left transparent for the same reason —
  /// a transparent PNG composited onto a dark viewer background is an invisible signature.
  Future<Uint8List?> toPng({double width = 600, double height = 200}) async {
    if (isEmpty) return null;

    final ui.PictureRecorder recorder = ui.PictureRecorder();
    final Canvas canvas = Canvas(recorder);

    canvas.drawRect(
      Rect.fromLTWH(0, 0, width, height),
      Paint()..color = const Color(0xFFFFFFFF),
    );

    // The strokes were captured in the canvas's logical coordinates, which vary by device.
    // Scaling to the fixed export size is what makes the output comparable.
    final double scaleX = _canvasSize.width == 0
        ? 1
        : width / _canvasSize.width;
    final double scaleY = _canvasSize.height == 0
        ? 1
        : height / _canvasSize.height;

    final Paint pen = Paint()
      ..color = const Color(0xFF000000)
      ..strokeWidth = 2.5
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..style = PaintingStyle.stroke;

    for (final SignatureStroke stroke in strokes) {
      if (stroke.points.isEmpty) continue;

      if (stroke.points.length == 1) {
        // A single tap has no line to draw. Render a dot, so a deliberate mark is not lost.
        final Offset p = stroke.points.first;
        canvas.drawCircle(
          Offset(p.dx * scaleX, p.dy * scaleY),
          1.6,
          Paint()..color = const Color(0xFF000000),
        );
        continue;
      }

      final Path path = Path()
        ..moveTo(
          stroke.points.first.dx * scaleX,
          stroke.points.first.dy * scaleY,
        );
      for (final Offset point in stroke.points.skip(1)) {
        path.lineTo(point.dx * scaleX, point.dy * scaleY);
      }
      canvas.drawPath(path, pen);
    }

    final ui.Image image = await recorder.endRecording().toImage(
      width.round(),
      height.round(),
    );
    final ByteData? data = await image.toByteData(
      format: ui.ImageByteFormat.png,
    );
    image.dispose();

    return data?.buffer.asUint8List();
  }
}

class SignaturePad extends StatefulWidget {
  const SignaturePad({super.key, required this.controller, this.height = 180});

  final SignaturePadController controller;
  final double height;

  @override
  State<SignaturePad> createState() => _SignaturePadState();
}

class _SignaturePadState extends State<SignaturePad> {
  final GlobalKey _canvasKey = GlobalKey();

  Size get _size {
    final RenderBox? box =
        _canvasKey.currentContext?.findRenderObject() as RenderBox?;
    return box?.size ?? Size.zero;
  }

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Container(
          key: _canvasKey,
          height: widget.height,
          decoration: BoxDecoration(
            color: c.elevated,
            borderRadius: BorderRadius.circular(AppMetrics.radiusMd),
            border: Border.all(color: c.border),
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(AppMetrics.radiusMd),
            child: GestureDetector(
              // `onPanX` rather than a Listener: pan gestures are already disambiguated from
              // the enclosing scroll view, so drawing does not scroll the page underneath.
              onPanStart: (DragStartDetails details) =>
                  widget.controller.begin(details.localPosition, _size),
              onPanUpdate: (DragUpdateDetails details) =>
                  widget.controller.extend(details.localPosition),
              onPanEnd: (DragEndDetails _) => widget.controller.end(),
              onTapDown: (TapDownDetails details) {
                widget.controller.begin(details.localPosition, _size);
                widget.controller.end();
              },
              child: AnimatedBuilder(
                animation: widget.controller,
                builder: (BuildContext context, Widget? _) => CustomPaint(
                  painter: _SignaturePainter(
                    strokes: widget.controller.strokes,
                    color: c.foreground,
                  ),
                  size: Size.infinite,
                  child: widget.controller.isEmpty
                      ? Center(
                          child: Text(
                            'Sign here',
                            style: Theme.of(context).textTheme.bodyMedium
                                ?.copyWith(color: c.mutedForeground),
                          ),
                        )
                      : null,
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: 10),
        Align(
          alignment: Alignment.centerRight,
          child: AnimatedBuilder(
            animation: widget.controller,
            builder: (BuildContext context, Widget? _) => AppButton(
              label: 'Clear signature',
              variant: AppButtonVariant.ghost,
              expand: false,
              icon: Icons.undo_rounded,
              onPressed: widget.controller.isEmpty
                  ? null
                  : widget.controller.clear,
            ),
          ),
        ),
      ],
    );
  }
}

class _SignaturePainter extends CustomPainter {
  _SignaturePainter({required this.strokes, required this.color});

  final List<SignatureStroke> strokes;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final Paint pen = Paint()
      ..color = color
      ..strokeWidth = 2.5
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..style = PaintingStyle.stroke;

    for (final SignatureStroke stroke in strokes) {
      if (stroke.points.length < 2) {
        if (stroke.points.length == 1) {
          canvas.drawCircle(stroke.points.first, 1.6, Paint()..color = color);
        }
        continue;
      }

      final Path path = Path()
        ..moveTo(stroke.points.first.dx, stroke.points.first.dy);
      for (final Offset point in stroke.points.skip(1)) {
        path.lineTo(point.dx, point.dy);
      }
      canvas.drawPath(path, pen);
    }
  }

  @override
  bool shouldRepaint(_SignaturePainter oldDelegate) => true;
}
