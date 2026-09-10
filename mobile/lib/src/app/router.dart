/// Routing and the auth gate.
///
/// ---------------------------------------------------------------------------------------
/// THE GATE IS A REDIRECT, NOT A WIDGET
///
/// The web client guards its app shell with a React context check inside the layout — the
/// route renders, then decides whether it should have. That works there because the whole app
/// is one static bundle behind a client-side router. Here the guard is a `redirect` evaluated
/// BEFORE the destination is built, so a protected screen never constructs with a null
/// session. That removes a whole family of bugs where a screen reads `session!.organizationId`
/// during the frame between navigation and the guard firing.
///
/// ---------------------------------------------------------------------------------------
/// WHAT THE GATE MUST NOT DO — DEF-012
///
/// The web sign-in form once rendered inside three nested `opacity: 0` motion wrappers, so if
/// the entrance animation did not complete, nobody could log in. The rule that came out of it
/// is in AGENTS.md: *decoration may fade in; forms and CTAs render visible.* Nothing on the
/// auth route here is gated behind an animation, and the redirect never leaves the app on a
/// screen with no way forward — an unresolved session shows a splash with a visible sign-out
/// escape rather than an indefinite spinner.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../auth/login_screen.dart';
import '../auth/session_controller.dart';
import '../auth/signup_screen.dart';
import '../screens/corrective_actions_screen.dart';
import '../screens/equipment_screen.dart';
import '../screens/home_screen.dart';
import '../screens/inspect_screen.dart';
import '../screens/inspection_detail_screen.dart';
import '../screens/inspections_screen.dart';
import '../screens/settings_screen.dart';
import '../widgets/app_widgets.dart';

/// Route paths, in one place.
///
/// A path typed as a string literal at a call site is a hardcoded value with no owner, and the
/// failure mode is a typo that compiles and produces a blank screen at runtime.
class Routes {
  const Routes._();

  static const String splash = '/';
  static const String login = '/auth/login';
  static const String signup = '/auth/signup';
  static const String home = '/app';
  static const String inspect = '/app/inspect';
  static const String inspections = '/app/inspections';
  static const String equipment = '/app/equipment';
  static const String corrective = '/app/corrective';
  static const String settings = '/app/settings';

  static String inspectionDetail(int id) => '/app/inspections/$id';

  /// Everything under here needs a resolved session.
  static bool isProtected(String location) => location.startsWith('/app');

  static bool isAuthRoute(String location) => location.startsWith('/auth');
}

final Provider<GoRouter> routerProvider = Provider<GoRouter>((Ref ref) {
  final _SessionRefresh refresh = _SessionRefresh(ref);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: Routes.splash,
    refreshListenable: refresh,
    routes: <RouteBase>[
      GoRoute(path: Routes.splash, builder: (_, _) => const _SplashScreen()),
      GoRoute(path: Routes.login, builder: (_, _) => const LoginScreen()),
      GoRoute(path: Routes.signup, builder: (_, _) => const SignupScreen()),
      GoRoute(
        path: Routes.home,
        builder: (_, _) => const HomeScreen(),
        routes: <RouteBase>[
          GoRoute(
            path: 'inspect',
            builder: (BuildContext context, GoRouterState state) =>
                InspectScreen(
                  equipmentId: state.uri.queryParameters['equipmentId'],
                  aiMode: state.uri.queryParameters['mode'] != 'manual',
                ),
          ),
          GoRoute(
            path: 'inspections',
            builder: (_, _) => const InspectionsScreen(),
            routes: <RouteBase>[
              GoRoute(
                path: ':id',
                builder: (BuildContext context, GoRouterState state) {
                  // A non-numeric id is a malformed deep link, not a crash. `inspections.id`
                  // is BIGINT, so anything unparseable cannot address a row.
                  final int? id = int.tryParse(
                    state.pathParameters['id'] ?? '',
                  );
                  if (id == null) {
                    return const _RouteError(
                      message: 'That inspection link is not valid.',
                    );
                  }
                  return InspectionDetailScreen(inspectionId: id);
                },
              ),
            ],
          ),
          GoRoute(
            path: 'equipment',
            builder: (_, _) => const EquipmentScreen(),
          ),
          GoRoute(
            path: 'corrective',
            builder: (_, _) => const CorrectiveActionsScreen(),
          ),
          GoRoute(path: 'settings', builder: (_, _) => const SettingsScreen()),
        ],
      ),
    ],
    errorBuilder: (BuildContext context, GoRouterState state) =>
        _RouteError(message: 'No screen at ${state.uri.path}.'),
    redirect: (BuildContext context, GoRouterState state) {
      final AsyncValue<AppSession?> session = ref.read(sessionProvider);
      final String location = state.matchedLocation;

      // Still resolving. Hold position rather than guessing: redirecting to login here would
      // bounce a signed-in user to the auth screen on every cold start, and redirecting to
      // the app would build a protected screen with no session.
      if (session.isLoading) {
        return location == Routes.splash ? null : Routes.splash;
      }

      // A failure resolving the session is NOT the same as being signed out. Sending the user
      // to login would ask them to re-enter credentials that are already valid and would not
      // fix a network error. The splash renders the error with a retry.
      if (session.hasError) {
        return location == Routes.splash ? null : Routes.splash;
      }

      final bool signedIn = session.value != null;

      if (!signedIn) {
        // Everything except the auth routes goes to login. The splash included: once the
        // session has resolved to "nobody", there is nothing for it to wait for.
        return Routes.isAuthRoute(location) ? null : Routes.login;
      }

      // Signed in. The auth routes and the splash have served their purpose.
      if (Routes.isAuthRoute(location) || location == Routes.splash) {
        return Routes.home;
      }

      return null;
    },
  );
});

/// Bridges Riverpod's session state to `GoRouter.refreshListenable`.
///
/// GoRouter re-evaluates `redirect` when this notifies. Without it the guard is only consulted
/// on navigation, so signing out while sitting on a protected screen would leave that screen
/// on display, fully populated, until the user happened to navigate.
class _SessionRefresh extends ChangeNotifier {
  _SessionRefresh(this._ref) {
    _subscription = _ref.listen<AsyncValue<AppSession?>>(sessionProvider, (
      AsyncValue<AppSession?>? previous,
      AsyncValue<AppSession?> next,
    ) {
      // Only when the ANSWER changes. The session provider also transitions through
      // loading states on refresh, and notifying on those makes the router re-run its
      // redirect mid-flight and bounce the user to the splash for a frame.
      final bool wasSignedIn = previous?.value != null;
      final bool isSignedIn = next.value != null;
      final bool settled = !next.isLoading;

      if (settled &&
          (wasSignedIn != isSignedIn || previous?.isLoading == true)) {
        notifyListeners();
      }
    }, fireImmediately: true);
  }

  final Ref _ref;
  late final ProviderSubscription<AsyncValue<AppSession?>> _subscription;

  @override
  void dispose() {
    _subscription.close();
    super.dispose();
  }
}

/// Shown while the session resolves, and where a resolution failure surfaces.
class _SplashScreen extends ConsumerWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<AppSession?> session = ref.watch(sessionProvider);

    return Scaffold(
      body: SafeArea(
        child: session.when(
          loading: () => const Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                BrandMark(size: 56),
                SizedBox(height: 28),
                LoadingState(),
              ],
            ),
          ),
          error: (Object error, StackTrace _) => Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: <Widget>[
                const BrandMark(size: 56),
                const SizedBox(height: 28),
                const MessageBanner(
                  // Deliberately not the raw error: a PostgREST failure names tables and
                  // policies, which tells a technician nothing and discloses the schema.
                  message: 'Could not load your account. Check your connection and try again.',
                  tone: BannerTone.error,
                ),
                const SizedBox(height: 16),
                AppButton(
                  label: 'Try again',
                  icon: Icons.refresh_rounded,
                  onPressed: () => ref.read(sessionProvider.notifier).refresh(),
                ),
                const SizedBox(height: 12),
                AppButton(
                  label: 'Sign in as someone else',
                  variant: AppButtonVariant.ghost,
                  // The escape hatch. Without it a user whose profile row is unreadable is
                  // stuck on this screen with no way to reach the login form.
                  onPressed: () => ref.read(sessionProvider.notifier).signOut(),
                ),
              ],
            ),
          ),
          // A resolved null means signed out; the redirect is already moving to login. This
          // frame is momentary.
          data: (AppSession? _) => const Center(child: BrandMark(size: 56)),
        ),
      ),
    );
  }
}

class _RouteError extends StatelessWidget {
  const _RouteError({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Not found')),
      body: SafeArea(
        child: ErrorState(
          message: message,
          onRetry: () => context.go(Routes.home),
        ),
      ),
    );
  }
}
