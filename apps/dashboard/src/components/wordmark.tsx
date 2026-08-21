import { cn } from "@/lib/utils";

/**
 * Three stacked bars, narrowing upward — a pricing ladder. Drawn in
 * currentColor so it inherits the surrounding text colour and works in both
 * themes without a second asset.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn("size-4 shrink-0", className)}
      fill="currentColor"
    >
      <rect x="2" y="15" width="20" height="5" rx="1.6" />
      <rect x="4.5" y="9" width="15" height="5" rx="1.6" opacity="0.66" />
      <rect x="7" y="3" width="10" height="5" rx="1.6" opacity="0.38" />
    </svg>
  );
}

export function Wordmark({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Mark />
      <span className="truncate font-semibold tracking-tight">{name}</span>
    </span>
  );
}
