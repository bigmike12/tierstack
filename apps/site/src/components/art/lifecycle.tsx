/**
 * What one API call sets in motion.
 *
 * Read left to right once, then notice the dashed arc: the last step is the
 * first step again. That loop is the difference between taking a payment and
 * running a subscription, and it is the only part of this picture the reader
 * has to remember.
 */
export function LifecycleArt({ className = "" }: { className?: string }) {
  const steps = ["Customer", "Subscription", "Invoice", "Payment", "Renewal"];
  const width = 108;
  const gap = 22;

  return (
    <svg
      viewBox="0 0 660 132"
      className={className}
      role="img"
      aria-label="Customer, subscription, invoice, payment, renewal — and the renewal opens the next invoice."
    >
      {steps.map((step, index) => {
        const x = 6 + index * (width + gap);
        const last = index === steps.length - 1;
        return (
          <g key={step}>
            <rect
              x={x}
              y="40"
              width={width}
              height="34"
              rx="17"
              fill={last ? "none" : "#14161A"}
              stroke={last ? "#14161A" : "none"}
              strokeWidth="1.4"
            />
            <text
              x={x + width / 2}
              y="62"
              textAnchor="middle"
              fontSize="12"
              fill={last ? "#14161A" : "#F6F4F0"}
            >
              {step}
            </text>
            {!last ? (
              <>
                <line x1={x + width} y1="57" x2={x + width + gap} y2="57" stroke="#C4C0B6" strokeWidth="1.4" />
                <path
                  d={`M ${x + width + gap - 6} 52 l 6 5 l -6 5`}
                  fill="none"
                  stroke="#C4C0B6"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </>
            ) : null}
          </g>
        );
      })}

      <path
        d="M 592 78 C 592 116, 300 122, 274 82"
        fill="none"
        stroke="#C4502B"
        strokeWidth="1.4"
        strokeDasharray="5 4"
        strokeLinecap="round"
      />
      <path d="M 268 90 l 6 -9 l 10 4" fill="none" stroke="#C4502B" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <text x="432" y="118" textAnchor="middle" fontSize="11" fill="#C4502B" fontFamily="ui-monospace, monospace">
        every period, without you
      </text>
    </svg>
  );
}
