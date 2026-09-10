/// Inspection photos, defect photos and signatures.
///
/// A faithful port of `src/lib/evidence.ts`, and the contract it implements is a security
/// boundary rather than a naming convention. DEF-017: evidence used to go into a PUBLIC bucket
/// under a filename that was only a millisecond timestamp (`signature-1757462400000.png`),
/// with no organisation anywhere in the path, addressed with `getPublicUrl()`. A public object
/// URL needs no session, no token and no policy check — so row level security protected the
/// database row that POINTED at the file while the file itself was served to anyone who asked,
/// across every tenant.
///
/// Four parts, all of them load-bearing:
///
///   1. A private bucket, so there is no unauthenticated read path at all.
///   2. The organisation as the FIRST path segment, because the storage policy scopes on
///      `storage.foldername(name)[1]`.
///   3. A random object name, so an address cannot be derived from a clock.
///   4. Short-lived signed URLs issued per view, so a leaked link stops working.
///
/// The stored value is always a PATH, never a URL. Persisting a URL is what made the original
/// bug permanent: the row carried a publicly resolvable address forever, so even after the
/// bucket was locked down the database would still have been handing out links.
library;

import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../config/app_config.dart';
import '../util/uuid.dart';
import 'supabase_service.dart';

/// Second path segment: what the object is evidence OF.
///
/// An enum rather than a string, so a typo is a compile error instead of an object filed under
/// a folder no policy and no query will ever look in.
enum EvidenceKind {
  inspection,
  signature,
  corrective,
  equipment;

  String get wire => name;
}

/// Image formats the bucket accepts.
///
/// Must stay in step with the `allowed_mime_types` on the bucket in
/// `20260910000300_storage.sql`. Uploading anything else fails with a generic 400 that names
/// neither the type nor the constraint.
enum EvidenceFormat {
  jpeg('image/jpeg', 'jpg'),
  png('image/png', 'png'),
  webp('image/webp', 'webp');

  const EvidenceFormat(this.mimeType, this.extension);

  final String mimeType;
  final String extension;

  static EvidenceFormat? fromMimeType(String mimeType) {
    for (final EvidenceFormat format in EvidenceFormat.values) {
      if (format.mimeType == mimeType) return format;
    }
    return null;
  }
}

class EvidenceRepository {
  EvidenceRepository(this._client);

  final SupabaseClient _client;

  StorageFileApi get _bucket => _client.storage.from(EvidenceConfig.bucket);

  /// Upload one object and return the path to store on the record.
  ///
  /// Throws on failure rather than returning null. The web client's original call sites did
  /// `if (!uploadError) { ...set the url... }`, which silently filed an inspection with no
  /// photo when the upload failed — the evidence was missing and nobody was told. On a
  /// compliance record that is the worst possible way to fail.
  Future<String> upload({
    required EvidenceKind kind,
    required String organizationId,
    required Uint8List bytes,
    required EvidenceFormat format,
  }) async {
    if (organizationId.isEmpty) {
      // Without this the object lands under a path beginning with `/`, which no policy
      // matches, and the upload is rejected with an opaque 400. Failing here names the
      // actual problem.
      throw StateError('Cannot store evidence without an organisation.');
    }

    final String path = EvidenceConfig.objectPath(
      organizationId: organizationId,
      kind: kind.wire,
      id: uuidV4(),
      extension: format.extension,
    );

    await _bucket.uploadBinary(
      path,
      bytes,
      fileOptions: FileOptions(
        contentType: format.mimeType,
        // Never overwrite. An upload that replaces existing evidence is indistinguishable
        // from tampering with it, and the name is a random UUID, so a collision means
        // something is wrong rather than something is duplicated.
        upsert: false,
      ),
    );

    return path;
  }

  /// A short-lived URL for viewing one stored object.
  ///
  /// Returns null instead of throwing: a missing thumbnail should degrade to a placeholder,
  /// not take down a screen listing a hundred inspections.
  Future<String?> signedUrl(String? path) async {
    if (path == null || path.isEmpty) return null;

    // A project restored from an older backup may still hold absolute public URLs written
    // before DEF-017 was fixed. Pass them through rather than crashing, so the record still
    // renders while the bucket is private underneath it.
    if (_isAbsoluteUrl(path)) return path;

    try {
      return await _bucket.createSignedUrl(
        path,
        EvidenceConfig.signedUrlTtlSeconds,
      );
    } catch (_) {
      return null;
    }
  }

  /// Sign many paths in one request.
  ///
  /// A list of inspections would otherwise make one round trip per row. At 50 rows that is 50
  /// sequential requests before the first thumbnail appears — an N+1 that only shows itself
  /// once real data exists, which is exactly when it is most expensive to discover.
  Future<Map<String, String>> signedUrls(Iterable<String?> paths) async {
    final Map<String, String> resolved = <String, String>{};

    final Set<String> needed = paths
        .whereType<String>()
        .where((String p) => p.isNotEmpty)
        .toSet();
    if (needed.isEmpty) return resolved;

    for (final String legacy in needed.where(_isAbsoluteUrl)) {
      resolved[legacy] = legacy;
    }

    final List<String> toSign = needed
        .where((String p) => !_isAbsoluteUrl(p))
        .toList();
    if (toSign.isEmpty) return resolved;

    try {
      // `createSignedUrlsResult`, not the deprecated `createSignedUrls`: the latter collapses
      // a path that could not be signed into an entry with an empty URL, indistinguishable
      // from a successful sign of nothing. Here a failure is its own case and is simply left
      // out of the map, which is what the caller's placeholder branch expects.
      final List<SignedUrlResult> signed = await _bucket.createSignedUrlsResult(
        toSign,
        EvidenceConfig.signedUrlTtlSeconds,
      );
      for (final SignedUrlResult entry in signed) {
        switch (entry) {
          case SignedUrlSuccess(:final String path, :final String signedUrl):
            if (signedUrl.isNotEmpty) resolved[path] = signedUrl;
          case SignedUrlFailure():
            // The object is gone or unreadable. A placeholder is correct; inventing a URL
            // that 404s at render time is not.
            break;
        }
      }
    } catch (_) {
      // Degrade to placeholders rather than failing the whole list.
    }

    return resolved;
  }

  static bool _isAbsoluteUrl(String value) =>
      RegExp(r'^https?://', caseSensitive: false).hasMatch(value);
}

final Provider<EvidenceRepository> evidenceRepositoryProvider =
    Provider<EvidenceRepository>(
      (Ref ref) => EvidenceRepository(ref.watch(supabaseClientProvider)),
    );
