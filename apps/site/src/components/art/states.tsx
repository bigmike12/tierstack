/**
 * The subscription state machine, with the product's real state names.
 *
 * Not a simplified version: these are the values the API returns, so a
 * developer reading the page and a developer reading a response are looking at
 * the same words. The green arc back to ACTIVE is the point of the picture —
 * PAST_DUE is a state you can come back from, and an application that models
 * only "paid" and "cancelled" has nowhere to put a customer who is in it.
 */
const BOX = { w: 112, h: 32 };

const SPINE = [
  { label: "ACTIVE", cx: 200 },
  { label: "PAST_DUE", cx: 332 },
  { label: "GRACE_PERIOD", cx: 464 },
  { label: "UNPAID", cx: 596 },
];

const ENTRY = [
  { label: "TRIALING", y: 66 },
  { label: "INCOMPLETE", y: 146 },
];

const ROW_Y = 106;
const ROW_MID = ROW_Y + BOX.h / 2;

export function StatesArt({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 670 222"
      className={className}
      role="img"
      aria-label="A subscription starts as trialing or incomplete and becomes active. From active it can go past due, then into a grace period. From the grace period it either recovers back to active or ends as unpaid."
    >
      {ENTRY.map((entry) => (
        <g key={entry.label}>
          <rect x="6" y={entry.y} width={BOX.w} height={BOX.h} rx="5" fill="none" stroke="#C4C0B6" strokeWidth="1.3" />
          <text x="62" y={entry.y + 21} textAnchor="middle" fontSize="11.5" fill="#6B6E76" fontFamily="ui-monospace, monospace">
            {entry.label}
          </text>
          <path
            d={`M 118 ${entry.y + BOX.h / 2} H 131 V ${ROW_MID} H 144`}
            fill="none"
            stroke="#C4C0B6"
            strokeWidth="1.3"
          />
        </g>
      ))}
      <path d={`M 138 ${ROW_MID - 5} l 6 5 l -6 5`} fill="none" stroke="#C4C0B6" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />

      {SPINE.map((state, index) => {
        const terminal = state.label === "UNPAID";
        const next = SPINE[index + 1];
        return (
          <g key={state.label}>
            <rect
              x={state.cx - BOX.w / 2}
              y={ROW_Y}
              width={BOX.w}
              height={BOX.h}
              rx="5"
              fill={terminal ? "none" : "#14161A"}
              stroke={terminal ? "#C4C0B6" : "none"}
              strokeWidth="1.3"
              strokeDasharray={terminal ? "4 3" : undefined}
            />
            <text
              x={state.cx}
              y={ROW_Y + 21}
              textAnchor="middle"
              fontSize="11.5"
              fill={terminal ? "#6B6E76" : "#F6F4F0"}
              fontFamily="ui-monospace, monospace"
            >
              {state.label}
            </text>
            {next ? (
              <>
                <line x1={state.cx + BOX.w / 2} y1={ROW_MID} x2={next.cx - BOX.w / 2} y2={ROW_MID} stroke="#C4C0B6" strokeWidth="1.3" />
                <path
                  d={`M ${next.cx - BOX.w / 2 - 6} ${ROW_MID - 5} l 6 5 l -6 5`}
                  fill="none"
                  stroke="#C4C0B6"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </>
            ) : null}
          </g>
        );
      })}

      {/* the way back */}
      <path d="M 464 106 C 464 44, 300 44, 212 98" fill="none" stroke="#16785C" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M 206 90 l 6 9 l 11 -3" fill="none" stroke="#16785C" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <text x="344" y="36" textAnchor="middle" fontSize="11" fill="#16785C" fontFamily="ui-monospace, monospace">
        payment recovered
      </text>

      <text x="398" y="204" textAnchor="middle" fontSize="11" fill="#C4502B" fontFamily="ui-monospace, monospace">
        the retry ladder runs through here
      </text>
      <text x="596" y="204" textAnchor="middle" fontSize="11" fill="#6B6E76" fontFamily="ui-monospace, monospace">
        retries spent
      </text>
    </svg>
  );
}
