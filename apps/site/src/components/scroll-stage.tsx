"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Shot } from "@/components/shot";

export type StageChapter = {
  /** The mono eyebrow — the same label the section used to carry as a band. */
  label: string;
  title: string;
  body: ReactNode;
  shot: {
    src: string;
    alt: string;
    width: number;
    height: number;
    caption: string;
  };
};

/**
 * The pinned run through the product.
 *
 * Four sections of this page used to be the same section four times: an
 * eyebrow, a claim, a paragraph and a screenshot, alternating sides. Read one
 * and you have read the shape of all of them, so the reader starts skimming
 * three screens before the page is done saying anything. They are one section
 * now — the frame holds still and the content moves through it, which is the
 * lifecycle those four screens actually describe.
 *
 * How it holds still: `position: sticky` inside a tall container. The browser
 * does the pinning, so the page never takes the scroll away from the reader —
 * scroll speed, trackpad momentum, a scrollbar drag, Page Down and Find on
 * Page all behave exactly as they do everywhere else, and the section is left
 * behind the moment its content is spent. Nothing here calls preventDefault.
 *
 * How the content moves: one passive scroll listener, coalesced into a single
 * rAF callback, whose entire job is to write one number — the floating-point
 * chapter position — into a CSS custom property. Every visual consequence of
 * that number is computed by CSS from opacity and transform alone, so the work
 * per frame stays on the compositor and off the main thread. No layout is read
 * in the frame except one `getBoundingClientRect`, and nothing is written that
 * can invalidate it.
 *
 * When it does none of that: below 1024px, on short viewports, and for anyone
 * who has asked their system for reduced motion, the whole mechanism is off —
 * the listener is never attached and the chapters render as four ordinary
 * stacked sections. That fallback is the CSS default in globals.css and the
 * pinning is what gets opted into, so the plain version is what ships if
 * anything about the enhancement fails.
 */
export function ScrollStage({
  eyebrow,
  chapters,
}: {
  eyebrow: string;
  chapters: StageChapter[];
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const stepRef = useRef(0);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || chapters.length < 2) return;

    // Matches the media query in globals.css that turns the pinning on. The
    // two have to agree: if JS drove the property while CSS was in its stacked
    // fallback, the panels would fade against a layout that isn't stacked.
    const query = window.matchMedia(
      "(min-width: 1024px) and (min-height: 640px) and (prefers-reduced-motion: no-preference)"
    );

    let frame = 0;
    let attached = false;

    const last = chapters.length - 1;
    // A tenth of the travel at each end holds the first and last chapter still,
    // so the sequence starts and finishes on a settled frame rather than
    // arriving mid-fade.
    const PAD = 0.1;

    const measure = () => {
      frame = 0;
      const travel = section.offsetHeight - window.innerHeight;
      if (travel <= 0) return;

      const raw = Math.min(Math.max(-section.getBoundingClientRect().top / travel, 0), 1);
      const eased = Math.min(Math.max((raw - PAD) / (1 - PAD * 2), 0), 1);
      const position = eased * last;

      section.style.setProperty("--p", position.toFixed(4));
      section.style.setProperty("--progress", eased.toFixed(4));

      const next = Math.round(position);
      if (next !== stepRef.current) {
        stepRef.current = next;
        setStep(next);
      }
    };

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };

    const attach = () => {
      if (attached) return;
      attached = true;
      window.addEventListener("scroll", schedule, { passive: true });
      window.addEventListener("resize", schedule, { passive: true });
      measure();
    };

    const detach = () => {
      if (!attached) return;
      attached = false;
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
      // Hand the panels back to the stacked fallback fully opaque.
      section.style.removeProperty("--p");
      section.style.removeProperty("--progress");
      stepRef.current = 0;
      setStep(0);
    };

    const sync = () => (query.matches ? attach() : detach());

    sync();
    query.addEventListener("change", sync);
    return () => {
      query.removeEventListener("change", sync);
      detach();
    };
  }, [chapters.length]);

  return (
    <section
      ref={sectionRef}
      className="stage bg-ink text-paper"
      style={{ "--chapters": chapters.length } as CSSProperties}
    >
      <div className="stage-pin relative overflow-hidden">
        {/* Ambient, and deliberately static: a fixed grid the content travels
            over reads as instrumentation, and costs nothing to composite. */}
        <div aria-hidden className="grid-field absolute inset-0 opacity-40" />

        <div className="relative mx-auto w-full max-w-6xl px-6 py-20 lg:py-0">
          <div className="flex items-baseline justify-between gap-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent-hover">
              {eyebrow}
            </p>
            <p aria-hidden className="stage-hud font-mono text-[11px] tracking-[0.2em] text-paper/40">
              {String(step + 1).padStart(2, "0")}
              <span className="px-1.5 text-paper/25">/</span>
              {String(chapters.length).padStart(2, "0")}
            </p>
          </div>

          {/* The rail: a track the fill crosses, with one tick per chapter that
              lights as the sequence reaches it. Decorative — the chapter it is
              reporting on is named in full inside every panel. */}
          {/* <div aria-hidden className="stage-hud stage-rail mt-5">
            <div className="relative h-px w-full bg-paper/15">
              <div className="stage-rail-fill absolute inset-y-0 left-0 bg-accent-hover" />
              {chapters.map((chapter, index) => (
                <span
                  key={chapter.label}
                  className="stage-tick absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-paper"
                  style={
                    {
                      "--i": index,
                      left: `${(index / (chapters.length - 1)) * 100}%`,
                    } as CSSProperties
                  }
                />
              ))}
            </div>
          </div> */}

          <div className="stage-deck mt-12 lg:mt-14">
            {chapters.map((chapter, index) => (
              <article
                key={chapter.label}
                className="stage-panel"
                style={{ "--i": index } as CSSProperties}
              >
                <div className="grid items-center gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:gap-14">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent-hover">
                      {chapter.label}
                    </p>
                    <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                      {chapter.title}
                    </h2>
                    <div className="mt-5 max-w-readable space-y-4 leading-relaxed text-paper/70 lg:text-lg">
                      {chapter.body}
                    </div>
                  </div>

                  <div className="stage-shot" style={{ "--i": index } as CSSProperties}>
                    <Shot {...chapter.shot} tone="ink" />
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
