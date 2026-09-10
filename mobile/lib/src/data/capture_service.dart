/// Photo capture and the downscale that has to happen before anything else.
///
/// A modern phone camera produces a 4–12 MB frame. Three separate things break if that is
/// used as-is:
///
///   1. `/api/analyze` caps the request body at `ANALYZE_MAX_IMAGE_BYTES`, and base64 inflates
///      the payload by a further third. A full-resolution frame is refused with a 400 that
///      says only "Image too large".
///   2. It is uploaded over the technician's mobile data, from a basement, on a metered plan.
///   3. It is held in the offline queue as a BLOB until there is signal — and a shift's worth
///      of un-synced inspections at 10 MB each fills the device.
///
/// So the resize is not an optimisation. Both numbers are owned by `CaptureConfig`, which
/// shares them with the web client's `src/lib/capture.ts`.
library;

import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image/image.dart' as img;
import 'package:image_picker/image_picker.dart';
import 'package:meta/meta.dart';

import '../config/app_config.dart';
import 'evidence_repository.dart';

/// The picked file was not an image this device can decode.
///
/// Distinct from a cancel (null) and from a camera failure (a `PlatformException` out of the
/// picker), because the three need three different sentences. Telling someone to check their
/// camera permission when the permission is fine and the FILE is broken sends them to a
/// settings screen that shows nothing wrong. DEF-050.
class UndecodablePhotoException implements Exception {
  const UndecodablePhotoException();

  @override
  String toString() =>
      'UndecodablePhotoException: the picked file could not be decoded';
}

/// One captured, downscaled photo.
@immutable
class CapturedPhoto {
  const CapturedPhoto({
    required this.bytes,
    required this.format,
    required this.width,
    required this.height,
  });

  final Uint8List bytes;
  final EvidenceFormat format;
  final int width;
  final int height;

  int get byteLength => bytes.length;
}

class CaptureService {
  CaptureService({ImagePicker? picker}) : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;

  /// Open the camera and return a downscaled JPEG, or null if the technician cancelled.
  Future<CapturedPhoto?> capture() => _pick(ImageSource.camera);

  /// Pick from the gallery.
  ///
  /// Offered because a technician may photograph an asset in a riser with no room to stand and
  /// review it before filing, and because the camera is unavailable on an emulator — which is
  /// where a lot of this gets exercised.
  Future<CapturedPhoto?> pickFromGallery() => _pick(ImageSource.gallery);

  Future<CapturedPhoto?> _pick(ImageSource source) async {
    final XFile? file = await _picker.pickImage(
      source: source,
      // The plugin resizes at capture time where the platform supports it, which avoids
      // decoding a 12 MP frame into memory at all. `downscale` below is still applied,
      // because this is a request and not every platform honours it.
      maxWidth: CaptureConfig.maxEdgePx.toDouble(),
      maxHeight: CaptureConfig.maxEdgePx.toDouble(),
      imageQuality: CaptureConfig.jpegQualityPercent,
      preferredCameraDevice: CameraDevice.rear,
    );

    if (file == null) return null; // Cancelled.

    final CapturedPhoto? photo = downscale(await file.readAsBytes());
    if (photo == null) throw const UndecodablePhotoException();
    return photo;
  }

  /// Decode, fit inside [CaptureConfig.maxEdgePx], re-encode as JPEG.
  ///
  /// Static and byte-in/byte-out so it can be unit-tested without a camera, a platform channel
  /// or a device.
  ///
  /// Returns null when the bytes are not a decodable image. That is a real case — a `.heic`
  /// from an iPhone whose conversion failed, or a truncated file — and it must not be filed as
  /// evidence. Silently uploading undecodable bytes would attach a broken photo to a
  /// compliance record.
  static CapturedPhoto? downscale(Uint8List bytes) {
    // `decodeImage` does NOT return null for undecodable input — it sniffs the bytes against
    // every format it knows, and a buffer too short for the header it is probing throws a
    // RangeError out of the decoder rather than declining. Empty bytes and a truncated file
    // both do it. So the contract above ("returns null") is enforced HERE; without this the
    // exception escaped to the capture screen, which caught everything and told the
    // technician to check a camera permission that was never the problem. DEF-050.
    final img.Image? decoded;
    try {
      decoded = img.decodeImage(bytes);
    } catch (_) {
      return null;
    }
    if (decoded == null) return null;

    // `bakeOrientation` applies the EXIF rotation to the pixels. Without it a portrait photo
    // taken on a phone is stored sideways: the pixel data is landscape and only the EXIF tag
    // says otherwise, and that tag is dropped by the re-encode below.
    final img.Image upright = img.bakeOrientation(decoded);

    final int longestEdge = upright.width > upright.height
        ? upright.width
        : upright.height;

    final img.Image resized = longestEdge <= CaptureConfig.maxEdgePx
        ? upright
        : img.copyResize(
            upright,
            width: upright.width >= upright.height
                ? CaptureConfig.maxEdgePx
                : null,
            height: upright.height > upright.width
                ? CaptureConfig.maxEdgePx
                : null,
            interpolation: img.Interpolation.average,
          );

    return CapturedPhoto(
      // JPEG, always. The bucket accepts jpeg/png/webp, and of those JPEG is the only one that
      // is both universally decodable by the AI providers and small for a photograph. PNG of a
      // camera frame is several times larger for no visible gain.
      bytes: Uint8List.fromList(
        img.encodeJpg(resized, quality: CaptureConfig.jpegQualityPercent),
      ),
      format: EvidenceFormat.jpeg,
      width: resized.width,
      height: resized.height,
    );
  }
}

final Provider<CaptureService> captureServiceProvider =
    Provider<CaptureService>((Ref ref) => CaptureService());
