/// Where the inspection happened.
///
/// Location is EVIDENCE on this record, not analytics. An inspection that claims an
/// extinguisher in a basement plant room was checked is materially stronger if it also records
/// that the phone was in that building. So it is captured where possible and, where not,
/// recorded as absent rather than approximated.
///
/// ---------------------------------------------------------------------------------------
/// IT IS ALSO PERSONAL DATA
///
/// A coordinate plus a timestamp plus a named employee is a record of where a specific worker
/// was at a specific minute. Under GDPR that is personal data about the technician, not only
/// about the asset, and collecting it silently would be an Art. 5(1)(a) problem regardless of
/// how useful it is. The UI therefore asks, explains why, and files the inspection without it
/// when refused — permission is declined, not the inspection.
library;

import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:meta/meta.dart';

import '../config/app_config.dart';
import 'inspection_repository.dart';

/// The outcome of asking for a position.
@immutable
class LocationFix {
  const LocationFix({
    this.point,
    this.address,
    this.denied = false,
    this.failed = false,
  });

  /// Null unless a full pair was obtained. See [GeoPoint] and `location_is_a_pair`.
  final GeoPoint? point;

  /// Best-effort human-readable address. Absent is normal.
  final String? address;

  /// The person or the OS refused.
  final bool denied;

  /// Location services are on and permitted, but no fix arrived.
  final bool failed;

  bool get hasPosition => point != null;

  static const LocationFix refused = LocationFix(denied: true);
  static const LocationFix unavailable = LocationFix(failed: true);
}

class LocationService {
  LocationService({http.Client? client}) : _http = client ?? http.Client();

  final http.Client _http;

  /// Ask for a fix. Never throws.
  ///
  /// Every failure path returns a [LocationFix] describing what happened, because the caller
  /// has to tell the technician something specific: "you declined" and "no signal" lead to
  /// different actions, and a single null cannot distinguish them.
  Future<LocationFix> current({bool reverseGeocode = true}) async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        return LocationFix.unavailable;
      }

      LocationPermission permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }

      // `deniedForever` cannot be re-prompted from here — only Settings can change it — so it
      // is reported as a refusal and the UI offers the manual path rather than a button that
      // does nothing.
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return LocationFix.refused;
      }

      final Position position = await Geolocator.getCurrentPosition(
        locationSettings: LocationSettings(
          // `high`, not `best`. `best` keeps the radio hunting for a fix it will not get
          // indoors — which is where this app is used — and drains the battery doing it.
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(milliseconds: GeoConfig.gpsTimeoutMs),
        ),
      );

      final GeoPoint? point = GeoPoint.tryCreate(
        position.latitude,
        position.longitude,
      );
      if (point == null) return LocationFix.unavailable;

      final String? address = reverseGeocode
          ? await _reverseGeocode(point)
          : null;
      return LocationFix(point: point, address: address);
    } catch (_) {
      // Includes the timeout, which indoors is the COMMON outcome rather than an error.
      return LocationFix.unavailable;
    }
  }

  /// Best-effort street address.
  ///
  /// Returns null on any failure. The address is a convenience for whoever reads the record
  /// later; the coordinates are the evidence, and losing the label must never lose the fix.
  ///
  /// Nominatim's usage policy requires a contactful User-Agent identifying the application —
  /// anonymous bulk traffic gets blocked, and a blocked geocoder means every inspection files
  /// without an address.
  Future<String?> _reverseGeocode(GeoPoint point) async {
    try {
      final Uri uri = Uri.parse(
        '${GeoConfig.reverseGeocodeUrl}?format=jsonv2&lat=${point.lat}&lon=${point.lng}',
      );

      final http.Response response = await _http
          .get(
            uri,
            headers: <String, String>{
              'User-Agent': GeoConfig.reverseGeocodeUserAgent,
              'Accept': 'application/json',
            },
          )
          .timeout(const Duration(seconds: 6));

      if (response.statusCode != 200) return null;

      final Object? decoded = jsonDecode(response.body);
      if (decoded is! Map<String, dynamic>) return null;

      final Object? display = decoded['display_name'];
      if (display is! String || display.trim().isEmpty) return null;

      // `location_address` is TEXT with no length cap, but a full Nominatim display name runs
      // to a couple of hundred characters of administrative hierarchy that helps nobody
      // reading an inspection report.
      final String trimmed = display.trim();
      return trimmed.length <= 200 ? trimmed : trimmed.substring(0, 200);
    } catch (_) {
      return null;
    }
  }

  void dispose() => _http.close();
}

final Provider<LocationService> locationServiceProvider =
    Provider<LocationService>((Ref ref) {
      final LocationService service = LocationService();
      ref.onDispose(service.dispose);
      return service;
    });
