// Help assistant — pure logic (no I/O). Unit-tested in unit/assist.test.mjs.
//
//   retrieve()        ranks the approved help articles for a question (no embeddings, no vector DB:
//                     ~20 short articles do not need them, and a lexical ranker is deterministic,
//                     free and testable — Rule 24 "simplest effective design").
//   modelsAllowed()   the COST GUARD: only `:free` model ids unless paid models are explicitly on.
//   accountIntents()  which read-only account summaries a question needs, if any.
//   buildMessages()   the chat messages sent to the model, with data fenced off from instructions.

export interface Article {
  id: string;
  title: string;
  roles: string[];
  keywords: string[];
  body: string;
  link: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const STOPWORDS = new Set(
  'a an and are as at be but by can do does for from how i in is it me my of on or so that the this to was what when where which who why will with you your'.split(' ')
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map((t) => (t.length > 4 && t.endsWith('s') ? t.slice(0, -1) : t)); // naive singular
}

/** Articles the caller's role may see, ranked for the question. Empty when nothing matches. */
export function retrieve(articles: Article[], question: string, role: string, k: number): Article[] {
  const q = tokenize(question);
  if (q.length === 0) return [];
  const visible = articles.filter((a) => a.roles.includes('all') || a.roles.includes(role));
  const scored = visible.map((a) => {
    const kw = new Set(a.keywords.flatMap(tokenize));
    const title = new Set(tokenize(a.title));
    const body = tokenize(a.body);
    const bodyCounts = new Map<string, number>();
    for (const t of body) bodyCounts.set(t, (bodyCounts.get(t) ?? 0) + 1);
    let score = 0;
    for (const t of q) {
      if (kw.has(t)) score += 3;
      if (title.has(t)) score += 2;
      const c = bodyCounts.get(t) ?? 0;
      if (c > 0) score += 1 + Math.log(c);
    }
    // Multi-word keyword phrases ("plan limit", "no signal") matched verbatim.
    const lowerQ = question.toLowerCase();
    for (const phrase of a.keywords) if (phrase.includes(' ') && lowerQ.includes(phrase)) score += 4;
    return { a, score };
  });
  return scored
    .filter((s) => s.score >= 3)
    .sort((x, y) => y.score - x.score || x.a.id.localeCompare(y.a.id))
    .slice(0, k)
    .map((s) => s.a);
}

/** COST GUARD. A model id that is not explicitly free is never called unless allowPaid is set. */
export function modelsAllowed(models: string[], allowPaid: boolean): string[] {
  return models.filter((m) => /^[a-z0-9._-]+\/[a-z0-9._:-]+$/i.test(m) && (allowPaid || m.endsWith(':free')));
}

export type AccountIntent = 'overdue_equipment' | 'open_actions' | 'plan_usage';

/** Which read-only summaries the question asks about. Lexical, so it is predictable and testable. */
export function accountIntents(question: string): AccountIntent[] {
  const q = question.toLowerCase();
  const mine = /\b(my|our|we|us|i have|do i|which|how many|what is|what's)\b/.test(q);
  const out: AccountIntent[] = [];
  if (mine && /\b(overdue|due|late|next inspection|needs? inspect)/.test(q)) out.push('overdue_equipment');
  if (mine && /\b(corrective|open action|actions|findings|defects?|outstanding)\b/.test(q)) out.push('open_actions');
  if (mine && /\b(plan|limit|usage|used|seats?|how many inspections|quota)\b/.test(q)) out.push('plan_usage');
  return out;
}

/** Remove control characters and clamp. Applied to every user-supplied string before use. */
export function cleanText(text: unknown, max: number): string {
  if (typeof text !== 'string') return '';
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

/** Make untrusted text safe to place inside our XML-ish data fences. */
function fence(text: string): string {
  return text.replace(/</g, '‹').replace(/>/g, '›');
}

export function buildMessages(opts: {
  systemPrompt: string;
  articles: Article[];
  accountData: string | null;
  history: ChatTurn[];
  question: string;
}): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  const help = opts.articles.length
    ? opts.articles.map((a) => `[${a.id}] ${a.title} (page: ${a.link})\n${a.body}`).join('\n\n')
    : '(no matching help article)';
  const context =
    `<help_articles>\n${fence(help)}\n</help_articles>` +
    (opts.accountData ? `\n<account_data>\n${fence(opts.accountData)}\n</account_data>` : '');
  return [
    { role: 'system', content: `${opts.systemPrompt}\n\n${context}` },
    ...opts.history.map((t) => ({ role: t.role, content: t.content })),
    { role: 'user', content: opts.question },
  ];
}

/** The answer we give when no model can be reached: the best article, verbatim, labelled. */
export function fallbackAnswer(articles: Article[], notice: string, noMatch: string): string {
  const best = articles[0];
  return best ? `${notice}\n\n${best.title}\n${best.body}` : noMatch;
}
