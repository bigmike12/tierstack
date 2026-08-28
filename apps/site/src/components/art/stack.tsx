/**
 * The whole argument of the site, drawn once.
 *
 * Three layers, top to bottom: the app, this, the rail. The middle box is the
 * only filled one, because the only thing a visitor has to take away in the
 * first five seconds is which layer Tierstack is.
 *
 * The dot travelling down the connectors is the sole motion. It runs downward
 * — a request going out, not money coming in — so it cannot be misread as a
 * revenue chart, which is the mistake an earlier hero made twice.
 */
export function StackArt({ className = "" }: { className?: string }) {
  const inside = [
    ["Plans", "Subscriptions", "Invoices"],
    ["Dunning", "Usage", "Entitlements"],
  ];

  return (
    <svg
      viewBox="0 0 340 424"
      className={className}
      role="img"
      aria-label="Your application calls Tierstack over an API. Tierstack runs plans, subscriptions, invoices, dunning, usage and entitlements, and calls the payment provider underneath."
    >
      {/* Your app */}
      <rect x="34" y="6" width="272" height="76" rx="8" fill="none" stroke="#14161A" strokeWidth="1.5" />
      <text x="170" y="36" textAnchor="middle" fontSize="13" fontWeight="600" letterSpacing="1.6" fill="#14161A" fontFamily="ui-monospace, monospace">
        YOUR APP
      </text>
      <text x="170" y="58" textAnchor="middle" fontSize="11.5" fill="#6B6E76" fontFamily="ui-monospace, monospace">
        SaaS · AI · API · marketplace
      </text>

      {/* app -> tierstack */}
      <line x1="170" y1="82" x2="170" y2="112" stroke="#C4C0B6" strokeWidth="1.5" />
      <path d="M 165 106 l 5 6 l 5 -6" fill="none" stroke="#C4C0B6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <text x="182" y="101" fontSize="10.5" letterSpacing="1.2" fill="#C4502B" fontFamily="ui-monospace, monospace">
        API
      </text>
      <circle className="flow-down" cx="170" cy="82" r="3.2" fill="#C4502B" />

      {/* Tierstack */}
      <rect x="6" y="112" width="328" height="184" rx="10" fill="#14161A" />
      <text x="170" y="146" textAnchor="middle" fontSize="14" fontWeight="600" letterSpacing="2.2" fill="#F6F4F0" fontFamily="ui-monospace, monospace">
        TIERSTACK
      </text>
      <line x1="34" y1="164" x2="306" y2="164" stroke="#F6F4F0" strokeOpacity="0.16" strokeWidth="1" />
      {inside.map((column, columnIndex) =>
        column.map((label, rowIndex) => (
          <text
            key={label}
            x={columnIndex === 0 ? 40 : 186}
            y={192 + rowIndex * 30}
            fontSize="12.5"
            fill="#F6F4F0"
            fillOpacity="0.82"
          >
            {label}
          </text>
        ))
      )}
      <text x="170" y="282" textAnchor="middle" fontSize="10.5" letterSpacing="1.4" fill="#F6F4F0" fillOpacity="0.45" fontFamily="ui-monospace, monospace">
        THE BILLING SYSTEM OF RECORD
      </text>

      {/* tierstack -> provider */}
      <line x1="170" y1="296" x2="170" y2="330" stroke="#C4C0B6" strokeWidth="1.5" />
      <path d="M 165 324 l 5 6 l 5 -6" fill="none" stroke="#C4C0B6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle className="flow-down flow-down-late" cx="170" cy="296" r="3.2" fill="#C4502B" />

      {/* Payment provider */}
      <rect x="34" y="330" width="272" height="76" rx="8" fill="none" stroke="#14161A" strokeWidth="1.5" strokeDasharray="5 4" />
      <text x="170" y="360" textAnchor="middle" fontSize="13" fontWeight="600" letterSpacing="1.6" fill="#14161A" fontFamily="ui-monospace, monospace">
        PAYMENT PROVIDER
      </text>
      <text x="170" y="382" textAnchor="middle" fontSize="11.5" fill="#6B6E76" fontFamily="ui-monospace, monospace">
        Paystack · your rail
      </text>
      <text x="170" y="420" textAnchor="middle" fontSize="10.5" letterSpacing="1.2" fill="#6B6E76" fontFamily="ui-monospace, monospace">
        MOVES THE MONEY
      </text>
    </svg>
  );
}
