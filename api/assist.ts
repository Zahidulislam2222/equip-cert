import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { serverConfig } from '../src/lib/config';
import { limiterFor } from '../src/lib/server-rate-limit';
import { clientIpOf, identifyCaller, type Caller } from '../src/lib/server-auth';
import {
  accountIntents,
  buildMessages,
  cleanText,
  fallbackAnswer,
  modelsAllowed,
  retrieve,
  type AccountIntent,
  type Article,
} from '../src/lib/assist/core';
import knowledge from '../src/content/help/knowledge.json';
import copy from '../src/content/assistant.json';

/**
 * In-app help assistant (global Rule 24).
 *
 * Who: any signed-in member of an organisation. What: answers from approved help articles plus,
 * when asked, a small read-only summary of the caller's OWN organisation, read with the caller's
 * JWT so RLS decides what is visible. It performs no actions and stores no conversation.
 *
 * Cost: only `:free` OpenRouter models (modelsAllowed), per-user and per-address rate limits, a
 * bounded input and output, a per-attempt timeout and at most one attempt per configured model —
 * no retries that multiply. Any failure degrades to the best matching article, never to an error.
 */
const limiter = limiterFor(serverConfig.assist.rateWindowMs);
const ARTICLES = knowledge.articles as Article[];

const turnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(serverConfig.assist.maxTurnChars * 2),
});
const bodySchema = z.object({
  question: z.string().min(1).max(serverConfig.assist.maxQuestionChars),
  history: z.array(turnSchema).max(serverConfig.assist.maxHistoryTurns * 2).optional(),
});

async function accountSummary(caller: Caller, intents: AccountIntent[]): Promise<string | null> {
  if (intents.length === 0) return null;
  const db = caller.userClient;
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [`As of ${today}, for the user's own organisation only:`];

  if (intents.includes('overdue_equipment')) {
    const { data, count } = await db
      .from('equipment')
      .select('name, next_due_date', { count: 'exact' })
      .eq('status', 'active')
      .lt('next_due_date', today)
      .order('next_due_date', { ascending: true })
      .limit(5);
    lines.push(
      `Active equipment overdue for inspection: ${count ?? 0}.` +
        (data?.length ? ` Oldest: ${data.map((e) => `${cleanText(e.name, 80)} (due ${e.next_due_date})`).join('; ')}.` : '')
    );
  }
  if (intents.includes('open_actions')) {
    // Exact counts (HEAD requests), so a large backlog is reported, not truncated at a page size.
    const open = () => db.from('corrective_actions').select('id', { count: 'exact', head: true }).neq('status', 'resolved');
    const [all, critical, major, minor, overdue] = await Promise.all([
      open(),
      open().eq('severity', 'critical'),
      open().eq('severity', 'major'),
      open().eq('severity', 'minor'),
      db.from('corrective_actions').select('id', { count: 'exact', head: true }).eq('status', 'overdue'),
    ]);
    // A failed count is "unknown", never "0" — the assistant must not state a false fact.
    if ([all, critical, major, minor, overdue].some((r) => r.error || r.count === null)) {
      lines.push('Open corrective actions: could not be read right now.');
    } else {
      lines.push(
        `Open corrective actions: ${all.count} (critical ${critical.count}, major ${major.count}, minor ${minor.count}); marked overdue: ${overdue.count}.`
      );
    }
  }
  if (intents.includes('plan_usage')) {
    const monthStart = `${today.slice(0, 7)}-01`;
    const [{ data: org }, { count: inspections }, { count: members }] = await Promise.all([
      db.from('organizations').select('plan').eq('id', caller.organizationId).maybeSingle(),
      db.from('inspections').select('id', { count: 'exact', head: true }).gte('created_at', monthStart),
      db.from('profiles').select('id', { count: 'exact', head: true }).is('anonymized_at', null),
    ]);
    const plan = org?.plan ?? 'unknown';
    const { data: limits } = await db
      .from('plan_limits')
      .select('max_users, max_inspections_month')
      .eq('plan_id', plan)
      .maybeSingle();
    lines.push(
      `Plan: ${plan}. Inspections this month: ${inspections ?? 0}` +
        `${limits?.max_inspections_month ? ` of ${limits.max_inspections_month}` : ' (unlimited)'}. ` +
        `Members: ${members ?? 0}${limits?.max_users ? ` of ${limits.max_users} seats` : ' (unlimited seats)'}.`
    );
  }
  return lines.join('\n');
}

async function callModel(model: string, messages: ReturnType<typeof buildMessages>): Promise<string | null> {
  const { baseUrl, apiKey, maxOutputTokens, timeoutMs, reasoningEffort, maxAnswerChars, temperatureTenths } = serverConfig.assist;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxOutputTokens,
        temperature: temperatureTenths / 10,
        // Reasoning models think first; keep it short and never return the reasoning text.
        reasoning: { effort: reasoningEffort, exclude: true },
      }),
    });
    if (!res.ok) {
      console.error(`Assist: model ${model} answered HTTP ${res.status}`);
      return null;
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = json.choices?.[0]?.message?.content;
    return typeof text === 'string' && text.trim() ? text.trim().slice(0, maxAnswerChars) : null;
  } catch (err) {
    console.error(`Assist: model ${model} failed: ${err instanceof Error ? err.name : 'error'}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  const cfg = serverConfig.assist;
  if (!cfg.enabled) return res.status(503).json({ error: 'The assistant is switched off.' });

  const ip = clientIpOf(req.headers['x-forwarded-for']);
  if ((await limiter.hit(`assist-ip:${ip}`, cfg.rateLimit * 5)).limited) {
    return res.status(429).json({ error: 'Too many questions. Try again later.' });
  }

  const who = await identifyCaller(req.headers.authorization);
  if (!who.ok) return res.status(who.status).json({ error: who.error });
  const { caller } = who;
  if ((await limiter.hit(`assist-user:${caller.userId}`, cfg.rateLimit)).limited) {
    return res.status(429).json({ error: `You've reached the limit of ${cfg.rateLimit} questions an hour. Try again later.` });
  }

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Ask a question of up to ' + cfg.maxQuestionChars + ' characters.' });
  const question = cleanText(parsed.data.question, cfg.maxQuestionChars);
  if (!question) return res.status(400).json({ error: 'Ask a question.' });
  const history = (parsed.data.history ?? [])
    .slice(-cfg.maxHistoryTurns * 2)
    .map((t) => ({ role: t.role, content: cleanText(t.content, cfg.maxTurnChars) }))
    .filter((t) => t.content);

  const articles = retrieve(ARTICLES, `${question} ${history.filter((t) => t.role === 'user').slice(-1)[0]?.content ?? ''}`, caller.role, cfg.knowledgeTopK);
  const sources = articles.map((a) => ({ id: a.id, title: a.title, link: a.link }));
  const meta = { knowledgeVersion: knowledge.version, promptVersion: copy.promptVersion };

  let accountData: string | null = null;
  try {
    accountData = await accountSummary(caller, accountIntents(question));
  } catch (err) {
    console.error('Assist: account summary failed:', err instanceof Error ? err.message : 'error');
  }

  const models = modelsAllowed(cfg.models, cfg.allowPaidModels);
  if (cfg.models.length > 0 && models.length === 0) {
    console.error('Assist: every configured model is paid and ASSIST_ALLOW_PAID_MODELS is not true — refusing to call any.');
  }
  if (!cfg.apiKey || models.length === 0) {
    return res.status(200).json({
      answer: fallbackAnswer(articles, copy.fallbackNotice, copy.noMatch),
      sources,
      aiGenerated: false,
      fallback: true,
      ...meta,
    });
  }

  const messages = buildMessages({
    systemPrompt: copy.systemPrompt.join('\n'),
    articles,
    accountData,
    history,
    question,
  });

  for (const model of models) {
    const answer = await callModel(model, messages);
    if (answer) {
      return res.status(200).json({ answer, sources, aiGenerated: true, model, fallback: false, ...meta });
    }
  }

  return res.status(200).json({
    answer: fallbackAnswer(articles, copy.fallbackNotice, copy.noMatch),
    sources,
    aiGenerated: false,
    fallback: true,
    ...meta,
  });
}
