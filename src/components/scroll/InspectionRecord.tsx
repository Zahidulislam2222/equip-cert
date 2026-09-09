'use client';

/**
 * The signature move: the page performs an inspection instead of describing one.
 *
 * A blank record is docked along the bottom of the hero from the first frame. As the camera
 * reaches each inspection point, that line commits — its reading appears, it takes a pass or
 * fail, and the counter advances. By the end of the sequence the record is complete and
 * stamped. Scrolling has not illustrated the headline "from walk-around to audit file"; it
 * has carried it out.
 *
 * Scroll-Craft asks every build for one bespoke interaction that belongs to that site alone.
 * Drag-to-rotate and explode-view are catalogue items; this is the one thing here that could
 * not be lifted onto another project without becoming nonsense.
 *
 * Two things it deliberately does not do:
 *
 * **It does not hide information.** Every reading is in the DOM from the start. Before a line
 * commits, its value is carried in a screen-reader-only span and the visible slot shows a
 * placeholder — so the assembling effect is purely visual and no one who cannot see it loses
 * a single fact. This is the same rule that DEF-012 was logged for.
 *
 * **It does not fake a real record.** The reference is fixed, the badge says example, and
 * there is no live clock: a timestamp generated at render would both imply a genuine audit
 * record and produce a hydration mismatch in a static export.
 */

import flight from '@/content/inspection-flight.json';

type Hotspot = {
  id: string;
  beat: string;
  read: { field: string; value: string; state: 'pass' | 'fail'; note: string };
};

const MODEL = flight.model as unknown as {
  example: { badge: string; equipment: string; serial: string };
  hotspots: Hotspot[];
  sequence: { at: number; beat: string | null }[];
};

/** Beats in the order the camera reaches them, so "committed" means "already passed". */
const ORDER: string[] = Array.from(
  new Set(MODEL.sequence.map((s) => s.beat).filter((b): b is string => Boolean(b)))
);

const SIGNED_BEAT = 'settle';

export function InspectionRecord({ activeBeat }: { activeBeat: string | null }) {
  const reached = activeBeat ? ORDER.indexOf(activeBeat) : -1;
  const signed = activeBeat === SIGNED_BEAT;
  const committedCount = MODEL.hotspots.filter(
    (h) => reached >= 0 && ORDER.indexOf(h.beat) <= reached
  ).length;

  return (
    <section
      aria-label="Inspection record"
      className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 border-t transition-colors duration-700 ${
        signed ? 'border-primary/45 bg-background/92' : 'border-border bg-background/80'
      } backdrop-blur-sm`}
    >
      <div className="mx-auto max-w-6xl px-5 py-3.5">
        {/* header */}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-[11px] uppercase tracking-[0.18em]">
          <p className="flex items-center gap-3 text-muted-foreground">
            <span className="font-medium text-foreground">Inspection record</span>
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] tracking-[0.14em]">
              {MODEL.example.badge}
            </span>
          </p>
          <p className="text-muted-foreground">
            <span className="tabular-nums text-foreground">{committedCount}</span>
            <span> / {MODEL.hotspots.length} checks</span>
            <span className="mx-2.5 text-border">|</span>
            <span>{MODEL.example.equipment}</span>
            <span className="mx-2.5 text-border">|</span>
            <span className="tabular-nums">{MODEL.example.serial}</span>
          </p>
        </div>

        {/* the lines, committing one at a time */}
        <dl className="mt-3 grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3">
          {MODEL.hotspots.map((hotspot, index) => {
            const committed = reached >= 0 && ORDER.indexOf(hotspot.beat) <= reached;
            const failed = hotspot.read.state === 'fail';
            return (
              <div
                key={hotspot.id}
                className={`flex items-baseline justify-between gap-3 bg-card px-3.5 py-2.5 transition-all duration-500 ${
                  committed ? 'opacity-100' : 'opacity-45'
                }`}
              >
                <dt className="flex items-baseline gap-2 text-xs">
                  <span className="tabular-nums text-muted-foreground/70">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className={committed ? 'text-foreground' : 'text-muted-foreground'}>
                    {hotspot.read.field}
                  </span>
                </dt>
                <dd className="flex items-baseline gap-2.5 text-xs">
                  {committed ? (
                    <>
                      <span className="font-medium tabular-nums">{hotspot.read.value}</span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                          failed
                            ? 'border-destructive/45 bg-destructive/10 text-destructive'
                            : 'border-success/40 bg-success/10 text-success'
                        }`}
                      >
                        {failed ? 'Fail' : 'Pass'}
                      </span>
                    </>
                  ) : (
                    <>
                      {/* The value is still here for assistive technology; only the visible
                          slot waits. The reveal is presentation, never information. */}
                      <span className="sr-only">
                        {hotspot.read.value}. {failed ? 'Fail' : 'Pass'}.
                      </span>
                      <span aria-hidden className="font-mono text-muted-foreground/50">
                        ————
                      </span>
                    </>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>

        {/* the stamp */}
        <p
          className={`mt-3 flex items-center gap-2.5 text-[11px] uppercase tracking-[0.18em] transition-all duration-700 ${
            signed ? 'text-primary opacity-100' : 'text-muted-foreground/55 opacity-70'
          }`}
        >
          <span
            aria-hidden
            className={`h-px transition-all duration-700 ${signed ? 'w-10 bg-primary' : 'w-4 bg-border'}`}
          />
          {signed
            ? 'Signed on the device. Row-level security now refuses every update and delete.'
            : 'Unsigned. Scroll to complete the walk-around.'}
        </p>
      </div>
    </section>
  );
}
