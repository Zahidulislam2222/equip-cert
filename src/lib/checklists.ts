import builtIn from '@/content/checklists.json';

export type ChecklistSource = 'cms' | 'built-in' | 'general';

export interface PickedChecklist {
  source: ChecklistSource;
  /** Where the questions come from, shown to the technician. */
  basis: string;
  questions: string[];
}

/** The parts of a Contentful `checklist` entry this needs (fields as the CDA returns them). */
export interface CmsChecklistEntry {
  fields: {
    equipmentType?: { fields?: { name?: string } } | null;
    questions?: unknown;
  };
}

/** Lower-case words, punctuation dropped: "Fire Extinguisher (CO2)" -> ["fire", "extinguisher", "co2"]. */
const words = (s: string | null | undefined) => (s ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Whether `needle`'s words appear, consecutively, as whole words in `hay`. */
function containsWords(hay: string[], needle: string[]): boolean {
  if (!needle.length || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((w, j) => hay[i + j] === w)) return true;
  }
  return false;
}

/**
 * "Fire Extinguisher" matches "fire extinguisher (CO2)" and vice versa — WHOLE words only, so "car"
 * does not match "carbon dioxide" nor "cart". An empty term matches nothing. A whole word can still
 * appear in a name ("hose" in "Extinguisher hose reel"); the type-first order below handles that.
 */
function matches(a: string[], b: string[]): boolean {
  return containsWords(a, b) || containsWords(b, a);
}

function questionsOf(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { questions?: unknown }).questions)
      ? (raw as { questions: unknown[] }).questions
      : [];
  return list
    .map((q) => {
      if (typeof q === 'string') return q;
      if (q && typeof q === 'object') {
        const o = q as { text?: unknown; question?: unknown };
        return typeof o.text === 'string' ? o.text : typeof o.question === 'string' ? o.question : '';
      }
      return '';
    })
    .map((q) => q.trim())
    .filter(Boolean);
}

/**
 * Choose the checklist for an asset: the CMS checklist for its type, else our built-in checklist
 * for that type, else the general one. NEVER an unrelated checklist — the old code fell back to the
 * CMS's first entry, which handed a fire extinguisher a smartphone checklist (E2E pass 2026-11-25).
 *
 * `terms` are the asset's TYPE first, then its name; empty terms are ignored. Each term is tried
 * against the CMS and then the built-in list before the next term, so the type always wins over a
 * word that happens to be in the name: a "Fire Extinguisher" named "Extinguisher - car park L2"
 * gets the extinguisher checklist, not a CMS "Car" one (fresh review 2026-11-25).
 */
export function pickChecklist(cmsEntries: readonly CmsChecklistEntry[], terms: readonly (string | null | undefined)[]): PickedChecklist {
  const wanted = terms.map(words).filter((w) => w.length > 0);

  for (const term of wanted) {
    for (const entry of cmsEntries) {
      if (!matches(term, words(entry.fields.equipmentType?.fields?.name))) continue;
      const questions = questionsOf(entry.fields.questions);
      if (questions.length) {
        return { source: 'cms', basis: entry.fields.equipmentType?.fields?.name ?? 'CMS checklist', questions };
      }
    }
    const type = builtIn.types.find((t) => t.match.some((m) => matches(term, words(m))));
    if (type) return { source: 'built-in', basis: type.basis, questions: [...type.questions] };
  }

  return { source: 'general', basis: builtIn.fallback.basis, questions: [...builtIn.fallback.questions] };
}
