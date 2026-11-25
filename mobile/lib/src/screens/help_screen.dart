/// Help assistant screen (global Rule 24) — the mobile counterpart of the web Help dialog.
///
/// Discloses that it is AI before the first question, offers suggested questions, shows the
/// articles each answer came from, says plainly when an answer is a help article rather than
/// an AI reply, lets the person stop waiting or start over, and always offers a human route.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/assist_api.dart';
import '../theme/app_theme.dart';
import '../widgets/app_widgets.dart';

class HelpScreen extends ConsumerStatefulWidget {
  const HelpScreen({super.key});

  @override
  ConsumerState<HelpScreen> createState() => _HelpScreenState();
}

class _Entry {
  const _Entry(this.turn, {this.answer});

  final AssistTurn turn;
  final AssistAnswer? answer;
}

class _HelpScreenState extends ConsumerState<HelpScreen> {
  final TextEditingController _question = TextEditingController();
  final List<_Entry> _entries = <_Entry>[];
  String? _error;

  /// Incremented on every send and on Stop / Start over, so a reply that arrives after the
  /// person stopped waiting is dropped instead of appearing out of nowhere.
  int _generation = 0;
  bool _waiting = false;

  @override
  void dispose() {
    _question.dispose();
    super.dispose();
  }

  Future<void> _send(String raw) async {
    final String question = raw.trim();
    if (question.isEmpty || _waiting) return;
    final List<AssistTurn> history = _entries
        .map((_Entry e) => e.turn)
        .toList(growable: false);
    final int generation = ++_generation;
    setState(() {
      _entries.add(_Entry(AssistTurn(fromUser: true, text: question)));
      _waiting = true;
      _error = null;
      _question.clear();
    });
    try {
      final AssistAnswer answer = await ref
          .read(assistApiProvider)
          .ask(question, history);
      if (!mounted || generation != _generation) return;
      setState(() {
        _entries.add(
          _Entry(
            AssistTurn(fromUser: false, text: answer.text),
            answer: answer,
          ),
        );
        _waiting = false;
      });
    } on AssistException catch (error) {
      if (!mounted || generation != _generation) return;
      setState(() {
        _error = error.message;
        _waiting = false;
      });
    }
  }

  void _stop() => setState(() {
    _generation++;
    _waiting = false;
  });

  void _restart() => setState(() {
    _generation++;
    _waiting = false;
    _error = null;
    _entries.clear();
  });

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);
    final TextTheme text = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Help'),
        actions: <Widget>[
          if (_entries.isNotEmpty)
            TextButton(onPressed: _restart, child: const Text('Start over')),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: <Widget>[
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
                children: <Widget>[
                  const MessageBanner(message: AssistCopy.disclosure),
                  const SizedBox(height: 16),
                  if (_entries.isEmpty) ...<Widget>[
                    Text(
                      'Try asking',
                      style: text.titleSmall?.copyWith(color: c.foreground),
                    ),
                    const SizedBox(height: 8),
                    for (final String s in AssistCopy.suggestions)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: AppButton(
                          label: s,
                          variant: AppButtonVariant.secondary,
                          onPressed: () => _send(s),
                        ),
                      ),
                  ],
                  for (final _Entry e in _entries) _bubble(context, e),
                  if (_waiting)
                    Semantics(
                      liveRegion: true,
                      child: Row(
                        children: <Widget>[
                          const Expanded(
                            child: LoadingState(message: 'Looking that up'),
                          ),
                          TextButton(
                            onPressed: _stop,
                            child: const Text('Stop'),
                          ),
                        ],
                      ),
                    ),
                  if (_error != null)
                    Semantics(
                      liveRegion: true,
                      child: MessageBanner(
                        message: _error!,
                        tone: BannerTone.error,
                      ),
                    ),
                  const SizedBox(height: 12),
                  Text(
                    AssistCopy.escalation,
                    style: text.bodySmall?.copyWith(color: c.mutedForeground),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: <Widget>[
                  Expanded(
                    child: AppTextField(
                      label: 'Your question',
                      controller: _question,
                      textInputAction: TextInputAction.send,
                      onSubmitted: _send,
                      enabled: !_waiting,
                      textCapitalization: TextCapitalization.sentences,
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    tooltip: 'Send question',
                    onPressed: _waiting ? null : () => _send(_question.text),
                    icon: const Icon(Icons.send_rounded),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _bubble(BuildContext context, _Entry e) {
    final AppColors c = colorsOf(context);
    final TextTheme text = Theme.of(context).textTheme;
    final AssistAnswer? a = e.answer;
    final String who = e.turn.fromUser
        ? 'You'
        : (a?.aiGenerated ?? false)
        ? 'AI assistant'
        : 'Help article (AI unavailable)';
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: AppCard(
        borderColor: e.turn.fromUser ? c.primary : null,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              who,
              style: text.labelMedium?.copyWith(color: c.mutedForeground),
            ),
            const SizedBox(height: 4),
            SelectableText(
              e.turn.text,
              style: text.bodyMedium?.copyWith(color: c.foreground),
            ),
            if (a != null && a.sources.isNotEmpty) ...<Widget>[
              const SizedBox(height: 8),
              Text(
                'Sources: ${a.sources.map((AssistSource s) => s.title).join(' · ')}',
                style: text.bodySmall?.copyWith(color: c.mutedForeground),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
