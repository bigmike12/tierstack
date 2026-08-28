/**
 * The retry ladder.
 *
 * Two failures and a recovery, spaced the way the default schedule actually
 * spaces them. This is the picture that explains why the software pays for
 * itself, so it is drawn literally rather than abstractly — a reader should be
 * able to point at the green mark and say "that is the money".
 */
export function LadderArt({ className = "" }: { className?: string }) {
  const attempts = [
    { day: "Day 0", x: 40, ok: false },
    { day: "Day 1", x: 140, ok: false },
    { day: "Day 3", x: 240, ok: true },
  ];

  return (
    <svg
      viewBox="0 0 320 150"
      className={className}
      role="img"
      aria-label="Three collection attempts across five days. The third one succeeds."
    >
      <line x1="24" y1="72" x2="296" y2="72" stroke="#3A3D45" strokeWidth="1.5" />

      {attempts.map((attempt, index) => (
        <g key={attempt.day} className="attempt" style={{ animationDelay: `${0.5 + index * 0.7}s` }}>
          <line x1={attempt.x} y1="60" x2={attempt.x} y2="84" stroke="#3A3D45" strokeWidth="1.5" />

          {attempt.ok ? (
            <>
              <circle cx={attempt.x} cy="72" r="14" fill="#16785C" />
              <path
                d={`M ${attempt.x - 6} 72 l 4 5 l 8 -10`}
                stroke="#F6F4F0"
                strokeWidth="2.4"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          ) : (
            <>
              <circle cx={attempt.x} cy="72" r="14" fill="none" stroke="#6B6E76" strokeWidth="1.5" />
              <path
                d={`M ${attempt.x - 5} 67 l 10 10 M ${attempt.x + 5} 67 l -10 10`}
                stroke="#6B6E76"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </>
          )}

          <text
            x={attempt.x}
            y="106"
            textAnchor="middle"
            fontSize="11"
            fill="#9A9DA5"
            fontFamily="ui-monospace, monospace"
          >
            {attempt.day}
          </text>
        </g>
      ))}

      <text
        x="240"
        y="126"
        textAnchor="middle"
        fontSize="11"
        fill="#16785C"
        fontFamily="ui-monospace, monospace"
      >
        collected
      </text>
    </svg>
  );
}
