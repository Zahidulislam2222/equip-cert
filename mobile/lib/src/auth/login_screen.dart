/// Sign in.
///
/// The whole form renders visible from the first frame. No entrance animation gates it, no
/// opacity wrapper, no "ready" flag — DEF-012 on the web client was three nested `opacity: 0`
/// motion wrappers around the sign-in form, and when the animation did not complete nobody
/// could log in at all. Decoration may fade; the critical path does not.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../app/router.dart';
import '../config/app_config.dart';
import '../theme/app_theme.dart';
import '../widgets/app_widgets.dart';
import 'auth_repository.dart';
import 'session_controller.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();

  bool _busy = false;
  bool _showPassword = false;
  String? _error;
  String? _notice;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;

    final String email = _email.text.trim();
    final String password = _password.text;

    if (email.isEmpty || password.isEmpty) {
      setState(() => _error = 'Enter your email and password.');
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });

    try {
      // `signIn` also runs `ensureProvisioned`, which is what repairs an account stranded by
      // the web client's broken signup (DEF-045).
      await ref
          .read(authRepositoryProvider)
          .signIn(email: email, password: password);

      // Resolve profile + organisation before the router lets a protected screen build.
      await ref.read(sessionProvider.notifier).refresh();

      // The redirect does the navigating. Doing it here as well races the guard.
    } on AuthException catch (error) {
      if (mounted) setState(() => _error = _describe(error));
    } catch (_) {
      if (mounted) {
        setState(
          () => _error =
              'Could not sign in. Check your connection and try again.',
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Turn a Supabase auth failure into something a technician can act on.
  ///
  /// Deliberately does NOT distinguish "no such account" from "wrong password". Supabase
  /// already returns one message for both, and preserving that is the point: a login form that
  /// says "no account with that email" is an account-enumeration oracle — an attacker can walk
  /// a list of addresses and learn which of your customers' staff are registered, without ever
  /// guessing a password.
  String _describe(AuthException error) {
    final String message = error.message.toLowerCase();

    if (message.contains('email not confirmed')) {
      return 'Confirm your email address first. Check your inbox for the link we sent when '
          'the account was created.';
    }
    if (message.contains('invalid login credentials')) {
      return 'That email and password do not match an account.';
    }
    if (message.contains('rate') || error.statusCode == '429') {
      return 'Too many attempts. Wait a minute and try again.';
    }
    return 'Could not sign in. Please try again.';
  }

  Future<void> _resetPassword() async {
    final String email = _email.text.trim();
    if (email.isEmpty) {
      setState(
        () => _error =
            'Enter your email address first, then tap Forgot password.',
      );
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      await ref.read(authRepositoryProvider).sendPasswordReset(email);
    } catch (_) {
      // Swallowed on purpose — see the notice below. Reporting a failure here would leak
      // whether the address is registered.
    }

    if (!mounted) return;
    setState(() {
      _busy = false;
      // Unconditional, whether or not the address exists. Same enumeration reasoning as
      // above. It is also honest: a reset mail was sent if there was anything to send it to.
      _notice =
          'If that address has an account, a reset link is on its way.\n\n'
          'Note: this project sends mail through the shared Supabase sender, which is capped '
          'at a very low rate for the whole project. If nothing arrives, ask an administrator.';
    });
  }

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);
    final TextTheme text = Theme.of(context).textTheme;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: ConstrainedBox(
              // Phones are the target, but this also runs on a tablet in landscape, where a
              // form stretched to 1000px is unusable.
              constraints: const BoxConstraints(maxWidth: 420),
              child: AutofillGroup(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    const Center(child: BrandMark(size: 52)),
                    const SizedBox(height: 32),
                    Text('Sign in', style: text.displaySmall),
                    const SizedBox(height: 8),
                    Text(
                      'Inspection records for ${AppInfo.name}.',
                      style: text.bodyMedium?.copyWith(
                        color: c.mutedForeground,
                      ),
                    ),
                    const SizedBox(height: 28),

                    if (_error != null) ...<Widget>[
                      MessageBanner(
                        message: _error!,
                        tone: BannerTone.error,
                        onDismiss: () => setState(() => _error = null),
                      ),
                      const SizedBox(height: 16),
                    ],

                    if (_notice != null) ...<Widget>[
                      MessageBanner(
                        message: _notice!,
                        tone: BannerTone.info,
                        onDismiss: () => setState(() => _notice = null),
                      ),
                      const SizedBox(height: 16),
                    ],

                    AppTextField(
                      label: 'Email',
                      controller: _email,
                      hint: 'you@company.com',
                      keyboardType: TextInputType.emailAddress,
                      textInputAction: TextInputAction.next,
                      autocorrect: false,
                      enabled: !_busy,
                      // Lets the platform password manager fill and, more importantly, SAVE
                      // the credential. Without these hints the OS never offers to store it,
                      // and a technician who cannot retrieve their password writes it down.
                      autofillHints: const <String>[AutofillHints.username],
                    ),
                    const SizedBox(height: 18),

                    AppTextField(
                      label: 'Password',
                      controller: _password,
                      obscureText: !_showPassword,
                      textInputAction: TextInputAction.done,
                      onSubmitted: (_) => _submit(),
                      enabled: !_busy,
                      autofillHints: const <String>[AutofillHints.password],
                      trailing: IconButton(
                        onPressed: () =>
                            setState(() => _showPassword = !_showPassword),
                        icon: Icon(
                          _showPassword
                              ? Icons.visibility_off_outlined
                              : Icons.visibility_outlined,
                          size: 20,
                        ),
                        color: c.mutedForeground,
                        // Not a convenience. A long passphrase typed one-handed in gloves is
                        // mistyped often, and "reveal" is what stops the person shortening it
                        // to something they can type reliably.
                        tooltip: _showPassword
                            ? 'Hide password'
                            : 'Show password',
                      ),
                    ),
                    const SizedBox(height: 24),

                    AppButton(
                      label: 'Sign in',
                      busy: _busy,
                      onPressed: _submit,
                    ),
                    const SizedBox(height: 12),

                    AppButton(
                      label: 'Forgot password',
                      variant: AppButtonVariant.ghost,
                      onPressed: _busy ? null : _resetPassword,
                    ),

                    const SizedBox(height: 24),
                    Divider(color: c.border),
                    const SizedBox(height: 16),

                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: <Widget>[
                        Text(
                          'No account yet?',
                          style: text.bodyMedium?.copyWith(
                            color: c.mutedForeground,
                          ),
                        ),
                        const SizedBox(width: 8),
                        AppButton(
                          label: 'Create one',
                          variant: AppButtonVariant.ghost,
                          expand: false,
                          onPressed: _busy
                              ? null
                              : () => context.go(Routes.signup),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
