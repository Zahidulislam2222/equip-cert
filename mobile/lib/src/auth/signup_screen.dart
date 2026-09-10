/// Create an account and a tenant.
///
/// ---------------------------------------------------------------------------------------
/// THIS SCREEN DOES NOT DO WHAT THE WEB ONE DOES — AND THAT IS THE FIX
///
/// The web client's signup creates the auth user, then inserts `organizations`, then inserts
/// `profiles`. Both inserts target policies declared `FOR INSERT TO authenticated`, and with
/// email confirmation on `auth.signUp()` returns a **null session** — so the caller is still
/// `anon`, `auth.uid()` is NULL, and both inserts are denied. Every signup strands an account
/// with no organisation, permanently. That is DEF-045, and it is the only path through the web
/// signup in every deployment.
///
/// Here, signup creates the auth account and NOTHING else. The organisation name rides in
/// `raw_user_meta_data`, which a session-less caller is allowed to write, and the tenant is
/// built by `AuthRepository.ensureProvisioned()` at first authenticated sign-in.
///
/// So this form ends at "check your inbox", and it says so plainly rather than implying the
/// workspace already exists.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../app/router.dart';
import '../config/app_config.dart';
import '../theme/app_theme.dart';
import '../widgets/app_widgets.dart';
import 'auth_repository.dart';
import 'password_safety.dart';

class SignupScreen extends ConsumerStatefulWidget {
  const SignupScreen({super.key});

  @override
  ConsumerState<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends ConsumerState<SignupScreen> {
  final TextEditingController _fullName = TextEditingController();
  final TextEditingController _organization = TextEditingController();
  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();

  final PasswordSafety _passwordSafety = PasswordSafety();

  bool _busy = false;
  bool _showPassword = false;
  bool _confirmationSent = false;
  String? _error;
  String? _passwordError;

  /// Debounces the breach lookup so it does not fire on every keystroke.
  ///
  /// Without this, typing a 20-character passphrase makes 20 range requests. The endpoint is
  /// free and rate-limited, and on a plant-room connection each one also costs the technician
  /// a visible stall.
  Timer? _passwordDebounce;

  @override
  void dispose() {
    _passwordDebounce?.cancel();
    _passwordSafety.dispose();
    _fullName.dispose();
    _organization.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  void _onPasswordChanged(String value) {
    _passwordDebounce?.cancel();

    // Length is local and instant, so it is reported without waiting for the network.
    if (value.isNotEmpty && value.length < PasswordSafetyConfig.minLength) {
      setState(
        () => _passwordError = describeVerdict(
          PasswordTooShort(PasswordSafetyConfig.minLength),
        ),
      );
      return;
    }

    setState(() => _passwordError = null);
    if (value.isEmpty) return;

    _passwordDebounce = Timer(const Duration(milliseconds: 600), () async {
      final PasswordVerdict verdict = await _passwordSafety.check(value);
      // The field may have changed while the request was in flight; a verdict about a
      // password the person is no longer typing is worse than no verdict.
      if (!mounted || _password.text != value) return;
      setState(() => _passwordError = describeVerdict(verdict));
    });
  }

  Future<void> _submit() async {
    if (_busy) return;

    final String fullName = _fullName.text.trim();
    final String organization = _organization.text.trim();
    final String email = _email.text.trim();
    final String password = _password.text;

    if (fullName.isEmpty ||
        organization.isEmpty ||
        email.isEmpty ||
        password.isEmpty) {
      setState(() => _error = 'Fill in every field.');
      return;
    }

    // `profiles.full_name` and `organizations.name` are both
    // `CHECK (length(btrim(x)) BETWEEN 1 AND 200)`. Catching it here produces a sentence;
    // letting it reach the database produces an opaque 23514 nobody can act on.
    if (fullName.length > AuthRepository.maxNameLength ||
        organization.length > AuthRepository.maxNameLength) {
      setState(
        () => _error =
            'Names must be ${AuthRepository.maxNameLength} characters or fewer.',
      );
      return;
    }

    if (!_looksLikeEmail(email)) {
      setState(() => _error = 'That does not look like an email address.');
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
    });

    // Blocking check, not the debounced one. The debounce may not have fired yet, and a
    // password refused only by a hint the user could scroll past is not refused.
    final PasswordVerdict verdict = await _passwordSafety.check(password);
    if (!verdict.ok) {
      if (mounted) {
        setState(() {
          _busy = false;
          _passwordError = describeVerdict(verdict);
        });
      }
      return;
    }

    try {
      final bool pending = await ref
          .read(authRepositoryProvider)
          .signUp(
            email: email,
            password: password,
            fullName: fullName,
            organizationName: organization,
          );

      if (!mounted) return;
      setState(() {
        _busy = false;
        _confirmationSent = pending;
      });

      // `pending == false` means auto-confirm was on and a session already exists, so
      // provisioning has run. The router's redirect takes it from here.
    } on AuthException catch (error) {
      if (mounted) setState(() => _error = _describe(error));
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = 'Could not create the account. Check your connection.',
        );
      }
    } finally {
      if (mounted && _busy) setState(() => _busy = false);
    }
  }

  String _describe(AuthException error) {
    final String message = error.message.toLowerCase();

    if (message.contains('already registered') ||
        message.contains('already been registered')) {
      // Supabase normally obfuscates this. If it surfaces, say the neutral thing.
      return 'If that address can be used, a confirmation email is on its way.';
    }
    if (message.contains('password')) {
      return 'That password was rejected: ${error.message}';
    }
    if (error.statusCode == '429' || message.contains('rate')) {
      return 'Too many attempts. Wait a minute and try again.';
    }
    return 'Could not create the account. Please try again.';
  }

  /// Deliberately permissive.
  ///
  /// A strict email regex is a well-known way to reject valid addresses — plus-addressing,
  /// new TLDs, quoted local parts. The only authority on whether an address works is whether
  /// the confirmation mail arrives, and that check happens anyway. This catches typing the
  /// name into the wrong field, nothing more.
  bool _looksLikeEmail(String value) =>
      RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(value);

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);
    final TextTheme text = Theme.of(context).textTheme;

    if (_confirmationSent) return _ConfirmationSent(email: _email.text.trim());

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: () => context.go(Routes.login),
          tooltip: 'Back to sign in',
        ),
        title: const Text('Create an account'),
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: AutofillGroup(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    Text('Set up your workspace', style: text.headlineMedium),
                    const SizedBox(height: 8),
                    Text(
                      'You will be the administrator of this organisation and can invite your '
                      'technicians afterwards.',
                      style: text.bodyMedium?.copyWith(
                        color: c.mutedForeground,
                      ),
                    ),
                    const SizedBox(height: 24),

                    if (_error != null) ...<Widget>[
                      MessageBanner(
                        message: _error!,
                        tone: BannerTone.error,
                        onDismiss: () => setState(() => _error = null),
                      ),
                      const SizedBox(height: 16),
                    ],

                    AppTextField(
                      label: 'Your name',
                      controller: _fullName,
                      hint: 'Alex Morgan',
                      textInputAction: TextInputAction.next,
                      textCapitalization: TextCapitalization.words,
                      enabled: !_busy,
                      autofillHints: const <String>[AutofillHints.name],
                      helper: 'This is the name that appears on every inspection you sign.',
                    ),
                    const SizedBox(height: 18),

                    AppTextField(
                      label: 'Organisation',
                      controller: _organization,
                      hint: 'Acme Fire Safety',
                      textInputAction: TextInputAction.next,
                      textCapitalization: TextCapitalization.words,
                      enabled: !_busy,
                      autofillHints: const <String>[
                        AutofillHints.organizationName,
                      ],
                    ),
                    const SizedBox(height: 18),

                    AppTextField(
                      label: 'Work email',
                      controller: _email,
                      hint: 'you@company.com',
                      keyboardType: TextInputType.emailAddress,
                      textInputAction: TextInputAction.next,
                      autocorrect: false,
                      enabled: !_busy,
                      autofillHints: const <String>[AutofillHints.newUsername],
                    ),
                    const SizedBox(height: 18),

                    AppTextField(
                      label: 'Password',
                      controller: _password,
                      obscureText: !_showPassword,
                      textInputAction: TextInputAction.done,
                      onSubmitted: (_) => _submit(),
                      onChanged: _onPasswordChanged,
                      enabled: !_busy,
                      errorText: _passwordError,
                      autofillHints: const <String>[AutofillHints.newPassword],
                      // NIST SP 800-63B: check candidates against breach corpora, and do NOT
                      // impose composition rules. So the guidance names length, not symbols.
                      helper:
                          'At least ${PasswordSafetyConfig.minLength} characters. A short '
                          'sentence you will remember beats a short scramble you will not.',
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
                        tooltip: _showPassword
                            ? 'Hide password'
                            : 'Show password',
                      ),
                    ),
                    const SizedBox(height: 8),

                    // The privacy note is on the form, not behind a link. This is the moment
                    // personal data is collected, so it is the moment Art. 13 information is
                    // owed.
                    Text(
                      'We check your password against public breach lists without sending it '
                      'anywhere: only the first five characters of its hash leave this device.',
                      style: text.bodySmall,
                    ),
                    const SizedBox(height: 24),

                    AppButton(
                      label: 'Create account',
                      busy: _busy,
                      onPressed: _submit,
                    ),
                    const SizedBox(height: 16),

                    Center(
                      child: AppButton(
                        label: 'I already have an account',
                        variant: AppButtonVariant.ghost,
                        expand: false,
                        onPressed: _busy
                            ? null
                            : () => context.go(Routes.login),
                      ),
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

/// The end of the signup flow.
///
/// This screen exists because the truthful outcome of signup is "go and read your email", not
/// "you are in". Sending someone to a dashboard that then bounces them back to login is how
/// the DEF-045 failure LOOKED to a user, and it is worth being explicit that nothing is broken.
class _ConfirmationSent extends StatelessWidget {
  const _ConfirmationSent({required this.email});

  final String email;

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);
    final TextTheme text = Theme.of(context).textTheme;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Icon(
                    Icons.mark_email_read_outlined,
                    size: 56,
                    color: c.success,
                  ),
                  const SizedBox(height: 24),
                  Text('Confirm your email', style: text.headlineMedium),
                  const SizedBox(height: 12),
                  Text(
                    'We sent a confirmation link to $email. Open it, then sign in — your '
                    'workspace is created on your first sign-in.',
                    style: text.bodyMedium,
                  ),
                  const SizedBox(height: 20),
                  const MessageBanner(
                    message:
                        'Mail on this project goes through the shared Supabase sender, '
                        'which is rate-limited for the whole project. If nothing arrives '
                        'within a few minutes, ask an administrator to check.',
                    tone: BannerTone.info,
                  ),
                  const SizedBox(height: 24),
                  AppButton(
                    label: 'Back to sign in',
                    onPressed: () => context.go(Routes.login),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
