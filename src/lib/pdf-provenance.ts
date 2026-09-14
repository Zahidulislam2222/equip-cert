/**
 * Provenance for a generated inspection report.
 *
 * WHY THIS IS A PURE FUNCTION AND NOT PROPS WRITTEN INLINE IN THE PDF COMPONENT
 *
 * EU AI Act Art. 50 is about the OUTPUT: content an AI system helped produce must be marked in a
 * machine-readable way and disclosed to the person reading it. The inspection row already carries
 * that provenance (`ai_assisted`, `ai_provider`, `ai_model`, `ai_disclosed_at`, constrained
 * together by `ai_provenance_is_complete`). The PDF is the copy that leaves the system — emailed to
 * an insurer, printed for a fire marshal — so it is the copy that has to carry the mark.
 *
 * A pure function can be unit tested against the one property that matters: an AI-assisted record
 * NEVER produces a report without the mark, and a human-only record never claims AI involvement.
 * The component only renders what this returns.
 *
 * WHERE THE MARK LIVES
 *
 *   machine-readable  the PDF Info dictionary: Subject and Keywords, which every PDF reader,
 *                     indexer and DMS exposes. Keywords use `key=value` pairs so a script can
 *                     parse them without guessing. The same pairs are repeated at the end of
 *                     Subject, so the mark survives a renderer that drops Keywords.
 *
 * WHY `keyboards` EXISTS (verified against @react-pdf/renderer 4.3.2, lib/react-pdf.js)
 *
 *   The renderer destructures the Document prop as `keyboards` — a typo — and maps THAT to
 *   /Keywords. Its own type definitions declare `keywords`, which it then ignores. A rendered PDF
 *   therefore had no /Keywords at all until the alias below was added; the unit test that renders
 *   a real PDF is what caught it. Both names are passed so the mark survives a fixed release too.
 *   human-readable    `disclosure`, rendered as a visible line on the report itself.
 *
 * What this is not: a C2PA manifest or a cryptographic watermark. The Commission's Art. 50 code of
 * practice is still being finalised; this is the proportionate marking available today for a text
 * document, recorded as such in docs/compliance.
 */

export interface ProvenanceSource {
  id: number | string;
  created_at: string;
  ai_assisted: boolean;
  ai_provider: string | null;
  ai_model: string | null;
  ai_disclosed_at: string | null;
}

export interface ReportProvenance {
  metadata: {
    title: string;
    author: string;
    subject: string;
    keywords: string;
    /** Same value as `keywords`; the name @react-pdf/renderer 4.3.2 actually reads. See header. */
    keyboards: string;
    creator: string;
    producer: string;
  };
  /** Visible disclosure line, or null when no AI system was involved. */
  disclosure: string | null;
}

/** Keep a provider-supplied value from breaking the `key=value; ` keyword grammar. */
function clean(value: string): string {
  return value.replace(/[;=\r\n]/g, ' ').trim();
}

function withMark(
  appName: string,
  id: ProvenanceSource['id'],
  sentence: string,
  pairs: string[],
): ReportProvenance['metadata'] {
  const keywords = pairs.join('; ');
  return {
    title: `Inspection report #${id}`,
    author: appName,
    creator: appName,
    producer: appName,
    subject: `${sentence} [${keywords}]`,
    keywords,
    keyboards: keywords,
  };
}

export function buildReportProvenance(record: ProvenanceSource, appName: string): ReportProvenance {
  if (!record.ai_assisted) {
    return {
      metadata: withMark(
        appName,
        record.id,
        'Equipment inspection record. No AI system was used to produce this record.',
        ['inspection', `record-id=${clean(String(record.id))}`, 'ai-assisted=false'],
      ),
      disclosure: null,
    };
  }

  // The database constraint guarantees provider and model when ai_assisted is true. A row that
  // somehow violates it still gets marked — as AI-assisted with an unknown system — rather than
  // silently producing an unmarked report.
  const provider = clean(record.ai_provider ?? 'unknown');
  const model = clean(record.ai_model ?? 'unknown');
  const disclosedAt = record.ai_disclosed_at ?? record.created_at;

  return {
    metadata: withMark(
      appName,
      record.id,
      'Equipment inspection record prepared with the assistance of an AI system ' +
        '(EU AI Act Art. 50 disclosure). The findings were reviewed by the named inspector.',
      [
        'inspection',
        `record-id=${clean(String(record.id))}`,
        'ai-assisted=true',
        `ai-provider=${provider}`,
        `ai-model=${model}`,
        `ai-disclosed-at=${clean(disclosedAt)}`,
        'disclosure=eu-ai-act-art-50',
      ],
    ),
    disclosure:
      `AI-assisted: the photo analysis in this record was produced with ${provider} / ${model} ` +
      `and reviewed by the inspector named above.`,
  };
}
