/**
 * A product screenshot, framed.
 *
 * Every image on this site is a capture of the real dashboard or the real
 * customer portal running against a real database — not a mockup, not a
 * rendering. The caption says the data is sampled, because it is, and a
 * landing page that shows you numbers should tell you where they came from.
 */
export function Shot({
  src,
  alt,
  width,
  height,
  caption,
  className = "",
  priority = false,
  tone = "paper",
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  caption?: string;
  className?: string;
  priority?: boolean;
  /**
   * Which ground the frame is sitting on. The caption is 11px, so on the ink
   * bands the muted grey it uses on paper falls to about 3:1 against the
   * background — legible to me, and not to a good share of the people this
   * page is for. On ink it is drawn from the paper colour instead.
   */
  tone?: "paper" | "ink";
}) {
  const ink = tone === "ink";

  return (
    <figure className={`m-0 ${className}`}>
      <div
        className={
          ink
            ? "overflow-hidden rounded-xl border border-paper/15 bg-white shadow-[0_24px_60px_-24px_rgba(0,0,0,0.65)]"
            : "overflow-hidden rounded-xl border border-line bg-white shadow-[0_1px_2px_rgba(20,22,26,0.04),0_12px_32px_-12px_rgba(20,22,26,0.16)]"
        }
      >
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          className="block h-auto w-full"
        />
      </div>
      {caption ? (
        <figcaption
          className={`mt-3 font-mono text-[11px] uppercase tracking-[0.14em] ${
            ink ? "text-paper/60" : "text-muted"
          }`}
        >
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
