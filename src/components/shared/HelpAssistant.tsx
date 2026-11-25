'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bot, Loader2, MessageCircleQuestion, RotateCcw, Send, Square, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import copy from '@/content/assistant.json';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: { id: string; title: string; link: string }[];
  aiGenerated?: boolean;
  fallback?: boolean;
}

/**
 * The in-app help assistant (Rule 24). AI disclosure first, before any question is sent; answers
 * render as plain text (React escapes them — model output is never injected as HTML); the user can
 * stop a request, start over, and is always shown the human route. Nothing is stored: closing the
 * panel's page discards the conversation.
 */
export function HelpAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setError(null);
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, { role: 'user', content: q }]);
    setInput('');
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Your session has expired. Sign in again.');
      const res = await fetch('/api/assist', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question: q, history }),
      });
      const json = (await res.json().catch(() => ({}))) as Partial<Message> & { answer?: string; error?: string };
      if (!res.ok || !json.answer) throw new Error(json.error || 'The assistant is unavailable right now.');
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: json.answer!, sources: json.sources, aiGenerated: json.aiGenerated, fallback: json.fallback },
      ]);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('Stopped.');
      } else {
        setError(err instanceof Error ? err.message : 'The assistant is unavailable right now.');
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const stop = () => abortRef.current?.abort();
  const restart = () => {
    stop();
    setMessages([]);
    setError(null);
    inputRef.current?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="help-assistant"
        className="fixed bottom-4 right-4 z-40 flex h-12 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <MessageCircleQuestion className="h-5 w-5" aria-hidden /> Help
      </button>

      {open && (
        <section
          id="help-assistant"
          role="dialog"
          aria-modal="false"
          aria-labelledby="help-assistant-title"
          className="fixed inset-x-0 bottom-0 z-50 flex h-[85dvh] flex-col border border-border bg-card shadow-elevated sm:inset-x-auto sm:bottom-20 sm:right-4 sm:h-[34rem] sm:w-[24rem] sm:rounded-xl"
        >
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 id="help-assistant-title" className="flex items-center gap-2 font-semibold font-display text-foreground">
              <Bot className="h-5 w-5 text-primary" aria-hidden /> Help assistant <span className="rounded bg-muted px-1.5 text-xs font-medium text-muted-foreground">AI</span>
            </h2>
            <div className="flex items-center gap-1">
              <button type="button" onClick={restart} aria-label="Start a new conversation" className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
                <RotateCcw className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                aria-label="Close help assistant"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
          </header>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite" aria-busy={busy}>
            <p className="rounded-lg bg-muted p-3 text-xs leading-relaxed text-muted-foreground">{copy.disclosure}</p>

            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Try asking:</p>
                {copy.suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => ask(s)}
                    className="block min-h-10 w-full rounded-lg border border-border px-3 py-2 text-left text-sm text-foreground hover:border-primary"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'ml-8' : 'mr-4'}>
                <p className="sr-only">{m.role === 'user' ? 'You said:' : 'Assistant answered:'}</p>
                <div
                  className={`whitespace-pre-wrap rounded-lg p-3 text-sm ${m.role === 'user' ? 'bg-primary/10 text-foreground' : 'border border-border bg-background text-foreground'}`}
                >
                  {m.content}
                </div>
                {m.role === 'assistant' && (
                  <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                    <p>{m.fallback ? 'Help article (AI unavailable)' : m.aiGenerated ? 'AI-generated — check important answers.' : ''}</p>
                    {m.sources && m.sources.length > 0 && (
                      <p>
                        Sources:{' '}
                        {m.sources.map((s, j) => (
                          <span key={s.id}>
                            {j > 0 && ', '}
                            <Link href={s.link} className="underline underline-offset-2 hover:text-foreground">
                              {s.title}
                            </Link>
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}

            {busy && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Thinking…
              </p>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {messages.length > 0 && <p className="text-xs text-muted-foreground">{copy.escalation}</p>}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask(input);
            }}
            className="flex items-end gap-2 border-t border-border p-3"
          >
            <label htmlFor="help-question" className="sr-only">Your question</label>
            <textarea
              id="help-question"
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void ask(input);
                }
              }}
              rows={2}
              maxLength={1000}
              placeholder="Ask about using EquipCert…"
              className="min-h-11 flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {busy ? (
              <button type="button" onClick={stop} aria-label="Stop" className="flex h-11 w-11 items-center justify-center rounded-lg border border-border text-foreground">
                <Square className="h-4 w-4" aria-hidden />
              </button>
            ) : (
              <button type="submit" aria-label="Send" disabled={!input.trim()} className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50">
                <Send className="h-4 w-4" aria-hidden />
              </button>
            )}
          </form>
        </section>
      )}
    </>
  );
}
