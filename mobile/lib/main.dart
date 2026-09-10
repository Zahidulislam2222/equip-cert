/// EquipCert AI — Android and iOS client.
///
/// ---------------------------------------------------------------------------------------
/// STARTUP FAILS VISIBLY OR NOT AT ALL
///
/// `SupabaseService.initialize()` throws when the build carries no configuration, and that
/// throw is caught here and rendered as a screen rather than left to the framework. A release
/// build that could not initialise otherwise shows the platform's grey error surface, or —
/// worse, if the throw is swallowed — a login form that rejects every correct password with a
/// network error. Neither tells the person holding the phone what is actually wrong.
///
/// This is the same fail-closed-and-say-so decision `api/analyze.ts` makes after DEF-034.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'src/app/router.dart';
import 'src/data/supabase_service.dart';
import 'src/offline/sync_service.dart';
import 'src/theme/app_theme.dart';
import 'src/widgets/app_widgets.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Portrait only. The flow is a single scrolling column operated one-handed while holding a
  // torch or a clipboard; landscape halves the visible checklist for no gain.
  await SystemChrome.setPreferredOrientations(<DeviceOrientation>[
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  String? startupError;
  try {
    await SupabaseService.initialize();
  } catch (error) {
    // The message names the missing define and the file that supplies it — see
    // SupabaseService. It is a developer-facing string and it is only reachable in a
    // misconfigured build, so showing it is more useful than hiding it.
    startupError = error is StateError
        ? error.message
        : 'The app could not start.';
  }

  runApp(
    ProviderScope(
      child: startupError == null
          ? const EquipCertApp()
          : _StartupFailure(message: startupError),
    ),
  );
}

class EquipCertApp extends ConsumerWidget {
  const EquipCertApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Read once at startup so the queue begins draining without waiting for a screen that
    // happens to watch it. A shift's first action is often opening the app in signal after
    // capturing offline the day before.
    ref.watch(syncProvider);

    return MaterialApp.router(
      title: 'EquipCert',
      debugShowCheckedModeBanner: false,
      routerConfig: ref.watch(routerProvider),

      // Dark is the approved default and the one the palette was designed against. Light is
      // registered so a device set to light does not get a dark-on-dark rendering of Material
      // defaults, but `themeMode` is not exposed as a preference: two visual identities to
      // maintain, for a tool used in plant rooms, is not a trade worth making.
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      themeMode: ThemeMode.dark,

      builder: (BuildContext context, Widget? child) {
        // The system text scale is honoured, and CLAMPED. Uncapped, a 2.0 scale turns a
        // checklist row into a full screen of text with its Pass/Fail buttons pushed out of
        // view; ignoring the setting entirely makes the app unusable for the people who set
        // it. 1.6 is where the layouts here stop reflowing cleanly.
        final MediaQueryData media = MediaQuery.of(context);
        return MediaQuery(
          data: media.copyWith(
            textScaler: media.textScaler.clamp(
              minScaleFactor: 1,
              maxScaleFactor: 1.6,
            ),
          ),
          child: child ?? const SizedBox.shrink(),
        );
      },
    );
  }
}

/// Shown when the app cannot initialise at all.
///
/// Deliberately not routed, not themed through the router, and dependent on nothing that
/// failed. A failure screen that itself needs the failed subsystem shows a blank window.
class _StartupFailure extends StatelessWidget {
  const _StartupFailure({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'EquipCert',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.dark,
      home: Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                const BrandMark(size: 56),
                const SizedBox(height: 28),
                const MessageBanner(
                  message: 'This build of EquipCert is not configured and cannot start.',
                  tone: BannerTone.error,
                ),
                const SizedBox(height: 16),
                Text(
                  message,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: colorsOf(context).mutedForeground,
                    height: 1.5,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
