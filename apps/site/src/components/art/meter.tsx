/**
 * An allowance, and what went past it.
 *
 * A single line rather than a grid. A grid makes a reader count; a line makes
 * them look once and see where the allowance ended and the extra began, which
 * is the only thing this picture has to say.
 */
export function MeterArt({ className = "" }: { className?: string }) {
  const units = 26;
  const included = 18;
  const used = 23;

  const size = 10;
  const gap = 4;
  const left = 4;

  return (
    <svg
      viewBox="0 0 380 92"
      className={className}
      role="img"
      aria-label="Usage running past an included allowance. The units past it are billed as overage."
    >
      {Array.from({ length: units }).map((_, index) => {
        const x = left + index * (size + gap);
        const isUsed = index < used;
        const isOver = index >= included && index < used;

        return (
          <rect
            key={index}
            x={x}
            y={34}
            width={size}
            height={22}
            rx="2"
            fill={isOver ? "#C4502B" : isUsed ? "#14161A" : "none"}
            stroke={isUsed ? "none" : "#E3DED4"}
            strokeWidth="1.5"
          />
        );
      })}

      {/* where the plan's allowance runs out */}
      <line
        x1={left + included * (size + gap) - gap / 2}
        y1="24"
        x2={left + included * (size + gap) - gap / 2}
        y2="66"
        stroke="#C4502B"
        strokeWidth="1.5"
      />
      <text
        x={left + included * (size + gap) - gap / 2 - 6}
        y="18"
        textAnchor="end"
        fontSize="10.5"
        fill="#6B6E76"
        fontFamily="ui-monospace, monospace"
      >
        included in the plan
      </text>
      <text
        x={left + included * (size + gap) + 6}
        y="18"
        fontSize="10.5"
        fill="#C4502B"
        fontFamily="ui-monospace, monospace"
      >
        billed as extra
      </text>

      <text x={left} y="82" fontSize="10.5" fill="#6B6E76" fontFamily="ui-monospace, monospace">
        counted from your own events
      </text>
    </svg>
  );
}
