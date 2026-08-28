/**
 * One billing layer, several possible rails.
 *
 * Deliberately not a scrolling marquee of provider names. A marquee implies
 * they are all there waiting to be switched on, and two of these three are not
 * written yet — a landing page that quietly contradicts its own status section
 * is worse than one with less movement.
 *
 * `dark` exists because this sits on the ink section, where the ledger box
 * cannot also be ink. On dark it inverts: the layer you own is the light one.
 */
export function RailsArt({ className = "", dark = false }: { className?: string; dark?: boolean }) {
  const rails = [
    { name: "PAYSTACK", live: true },
    { name: "MONNIFY", live: false },
    { name: "FLUTTERWAVE", live: false },
  ];

  return (
    <div className={className}>
      <div
        className={
          dark
            ? "rounded-lg bg-paper px-5 py-4 text-ink"
            : "rounded-lg border border-ink bg-ink px-5 py-4 text-paper"
        }
      >
        <p
          className={`font-mono text-[11px] uppercase tracking-[0.18em] ${
            dark ? "text-muted" : "text-paper/55"
          }`}
        >
          Your billing layer
        </p>
        <p className="mt-1.5 text-sm">Plans, subscriptions, invoices, entitlements — the record</p>
      </div>

      {/* the seam between what you own and what merely carries it */}
      <div className={`ml-6 h-6 w-px ${dark ? "bg-paper/25" : "bg-line"}`} aria-hidden />

      <div className="flex flex-wrap gap-2">
        {rails.map((rail) => (
          <span
            key={rail.name}
            className={
              rail.live
                ? `rounded-md border px-3.5 py-2 font-mono text-[11px] tracking-[0.14em] ${
                    dark ? "border-paper/60 text-paper" : "border-ink bg-paper"
                  }`
                : `rounded-md border border-dashed px-3.5 py-2 font-mono text-[11px] tracking-[0.14em] ${
                    dark ? "border-paper/25 text-paper/45" : "border-line text-muted"
                  }`
            }
          >
            {rail.name}
            {rail.live ? (
              <span aria-hidden className="ml-2 inline-block size-1.5 rounded-full bg-settled align-middle" />
            ) : null}
          </span>
        ))}
      </div>

      <p
        className={`mt-3 font-mono text-[11px] uppercase tracking-[0.16em] ${
          dark ? "text-paper/45" : "text-muted"
        }`}
      >
        Solid is verified · dashed is not written yet
      </p>
    </div>
  );
}
