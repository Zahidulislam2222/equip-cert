/// The resize that has to happen before a camera frame becomes anything else.
///
/// ---------------------------------------------------------------------------------------
/// WHY THIS IS NOT AN OPTIMISATION TEST
///
/// A phone camera produces a 4–12 MB frame. If `downscale` silently stops shrinking it, three
/// separate things break and none of them says why:
///
///   1. `/api/analyze` refuses the body with a 400 that reads only "Image too large" — base64
///      inflates the payload by a further third on top of the raw size.
///   2. It is uploaded over the technician's metered mobile data, from a basement.
///   3. It sits in the offline queue as a BLOB until there is signal, and a shift's worth of
///      un-synced inspections at 10 MB each fills the device.
///
/// `downscale` is static and byte-in/byte-out precisely so this can be checked with no
/// camera, no platform channel and no device.
library;

import 'dart:io';
import 'dart:typed_data';

import 'package:equipcert_mobile/src/config/app_config.dart';
import 'package:equipcert_mobile/src/data/capture_service.dart';
import 'package:equipcert_mobile/src/data/evidence_repository.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;

/// A recognisable test frame: a gradient, so a resize is visible in the pixels rather than
/// producing a flat block that would survive any transformation at all.
img.Image _frame(int width, int height) {
  final img.Image image = img.Image(width: width, height: height);
  for (int y = 0; y < height; y++) {
    for (int x = 0; x < width; x++) {
      image.setPixelRgb(x, y, (x * 255) ~/ width, (y * 255) ~/ height, 128);
    }
  }
  return image;
}

Uint8List _jpeg(int width, int height) =>
    Uint8List.fromList(img.encodeJpg(_frame(width, height)));

Uint8List _png(int width, int height) =>
    Uint8List.fromList(img.encodePng(_frame(width, height)));

/// The server's request-body cap, read from the file that owns the variable name.
///
/// Fails rather than returning a default. A test that quietly falls back to an assumed cap
/// still reports green while measuring nothing.
int _analyzeMaxImageBytes() {
  final File env = File('../.env.example');
  expect(
    env.existsSync(),
    isTrue,
    reason: 'expected ../.env.example beside mobile/',
  );

  final RegExpMatch? match = RegExp(
    r'^ANALYZE_MAX_IMAGE_BYTES=(\d+)',
    multiLine: true,
  ).firstMatch(env.readAsStringSync());
  expect(
    match,
    isNotNull,
    reason: 'ANALYZE_MAX_IMAGE_BYTES is not declared in .env.example',
  );

  return int.parse(match!.group(1)!);
}

void main() {
  final int maxEdge = CaptureConfig.maxEdgePx;

  group('undecodable input is refused, never filed as evidence', () {
    test('random bytes return null', () {
      // A truncated file, or a .heic whose conversion failed. Uploading undecodable bytes
      // would attach a broken photo to a compliance record and nobody would find out until
      // someone opened the report.
      expect(
        CaptureService.downscale(Uint8List.fromList(<int>[1, 2, 3, 4, 5])),
        isNull,
      );
    });

    test('empty bytes return null', () {
      expect(CaptureService.downscale(Uint8List(0)), isNull);
    });

    test('a truncated JPEG returns null rather than a partial image', () {
      final Uint8List whole = _jpeg(400, 300);
      final Uint8List head = Uint8List.sublistView(whole, 0, 20);

      expect(CaptureService.downscale(head), isNull);
    });
  });

  group('the long edge is brought inside the configured cap', () {
    test('a landscape frame is capped on its width', () {
      final CapturedPhoto photo = CaptureService.downscale(_jpeg(3000, 2000))!;

      expect(photo.width, maxEdge);
      expect(photo.height, lessThan(maxEdge));
    });

    test('a portrait frame is capped on its height', () {
      final CapturedPhoto photo = CaptureService.downscale(_jpeg(2000, 3000))!;

      expect(photo.height, maxEdge);
      expect(photo.width, lessThan(maxEdge));
    });

    test('a square frame is capped on both edges', () {
      final CapturedPhoto photo = CaptureService.downscale(_jpeg(2400, 2400))!;

      expect(photo.width, maxEdge);
      expect(photo.height, maxEdge);
    });

    test('the aspect ratio survives the resize', () {
      final CapturedPhoto photo = CaptureService.downscale(_jpeg(3000, 2000))!;

      // 3:2 in, 3:2 out. A stretched photo of a pressure gauge is worse than no photo.
      expect(photo.width / photo.height, closeTo(1.5, 0.01));
    });

    test('an extreme panorama is still brought inside the cap', () {
      final CapturedPhoto photo = CaptureService.downscale(_jpeg(4000, 200))!;

      expect(photo.width, maxEdge);
      expect(photo.height, greaterThan(0));
    });
  });

  group('a small photo is left alone', () {
    test('a frame already under the cap keeps its exact dimensions', () {
      // Upscaling would invent pixels and make the file bigger for no evidential gain.
      final CapturedPhoto photo = CaptureService.downscale(_jpeg(800, 600))!;

      expect(photo.width, 800);
      expect(photo.height, 600);
    });

    test('a frame exactly at the cap is not resized', () {
      final CapturedPhoto photo = CaptureService.downscale(
        _jpeg(maxEdge, 900),
      )!;

      expect(photo.width, maxEdge);
      expect(photo.height, 900);
    });

    test('one pixel over the cap IS resized — the boundary is <=, not <', () {
      final CapturedPhoto photo = CaptureService.downscale(
        _jpeg(maxEdge + 1, 900),
      )!;

      expect(photo.width, maxEdge);
    });

    test('a one-pixel image survives instead of collapsing to zero', () {
      final CapturedPhoto photo = CaptureService.downscale(_jpeg(1, 1))!;

      expect(photo.width, 1);
      expect(photo.height, 1);
    });
  });

  group('the output is always a JPEG the bucket and the providers accept', () {
    test('a PNG in becomes a JPEG out', () {
      // The bucket accepts jpeg/png/webp, but a PNG of a camera frame is several times larger
      // for no visible gain, and JPEG is the one every AI provider decodes.
      final CapturedPhoto photo = CaptureService.downscale(_png(2000, 1500))!;

      expect(photo.format, EvidenceFormat.jpeg);
      expect(photo.bytes.sublist(0, 2), <int>[0xFF, 0xD8]);
    });

    test('the declared format matches the bytes and the mime type', () {
      final CapturedPhoto photo = CaptureService.downscale(_jpeg(2000, 1500))!;

      expect(photo.format, EvidenceFormat.jpeg);
      expect(photo.format.mimeType, 'image/jpeg');
      expect(photo.bytes.sublist(0, 2), <int>[0xFF, 0xD8]);
    });

    test('the re-encoded frame is decodable — the evidence is not corrupt', () {
      final CapturedPhoto photo = CaptureService.downscale(_jpeg(3000, 2000))!;
      final img.Image? reread = img.decodeImage(photo.bytes);

      expect(reread, isNotNull);
      expect(reread!.width, photo.width);
      expect(reread.height, photo.height);
    });

    test('the declared dimensions match the encoded pixels, not the input', () {
      final CapturedPhoto photo = CaptureService.downscale(_jpeg(3000, 2000))!;

      expect(photo.width, isNot(3000));
      expect(img.decodeImage(photo.bytes)!.width, photo.width);
    });

    test('byteLength reports the real length', () {
      final CapturedPhoto photo = CaptureService.downscale(_jpeg(800, 600))!;

      expect(photo.byteLength, photo.bytes.length);
    });
  });

  group('the size actually comes down — the point of the whole function', () {
    test('the pixel count drops by roughly the square of the scale factor', () {
      // Measured in PIXELS, not in encoded bytes. A synthetic gradient compresses far better
      // than a photograph does, so asserting on the fixture's file size would be measuring
      // the test's own image rather than the function — it passed at 3000x2000 only because
      // PNG happened to squeeze a smooth gradient into 23 KB.
      final CapturedPhoto photo = CaptureService.downscale(_jpeg(4000, 3000))!;

      const int before = 4000 * 3000;
      final int after = photo.width * photo.height;

      expect(after, lessThan(before ~/ 5));
    });

    test('re-encoding a large frame produces fewer bytes than it consumed', () {
      final Uint8List original = _jpeg(4000, 3000);
      final CapturedPhoto photo = CaptureService.downscale(original)!;

      expect(photo.byteLength, lessThan(original.length));
    });

    test('the result clears the analyze body cap with room for base64 inflation', () {
      // The cap is a SERVER value — the mobile client has no copy of it and must not invent
      // one — so it is read from the file that owns the variable, the same way
      // `schema_contract_test.dart` reads the migrations. Hardcoding 10 MB here would create
      // a second owner that drifts silently the day the server value changes.
      final int cap = _analyzeMaxImageBytes();
      final CapturedPhoto photo = CaptureService.downscale(_jpeg(4000, 3000))!;

      // base64 costs a further third, and the cap is applied to the encoded body.
      expect((photo.byteLength * 4) ~/ 3, lessThan(cap));
    });
  });

  group('EXIF orientation is baked into the pixels', () {
    test('a frame tagged as rotated comes out physically rotated', () {
      // Without `bakeOrientation` a portrait phone photo is stored sideways: the pixel data is
      // landscape and only the EXIF tag says otherwise — and that tag is dropped by the
      // re-encode, so the sideways version is what ends up on the report for good.
      final img.Image image = _frame(400, 200);
      image.exif.imageIfd.orientation = 6; // rotate 90° clockwise
      final Uint8List tagged = Uint8List.fromList(img.encodeJpg(image));

      final CapturedPhoto photo = CaptureService.downscale(tagged)!;

      expect(photo.width, 200);
      expect(photo.height, 400);
    });

    test('an untagged frame is not rotated', () {
      final CapturedPhoto photo = CaptureService.downscale(_jpeg(400, 200))!;

      expect(photo.width, 400);
      expect(photo.height, 200);
    });
  });
}
