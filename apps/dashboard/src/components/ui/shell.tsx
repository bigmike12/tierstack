import * as React from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 pb-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-14 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}

/**
 * Used for the sections whose engine is not built yet. It states the phase
 * plainly rather than showing a fake chart or a zeroed table, which would read
 * as "no data" when the truth is "not implemented".
 */
export function NotBuiltYet({
  title,
  phase,
  description,
  whatWorks,
}: {
  title: string;
  phase: string;
  description: string;
  whatWorks?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border p-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          {phase}
        </span>
      </div>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
      {whatWorks ? <div className="mt-5 text-sm text-muted-foreground">{whatWorks}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "warning" | "danger";
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "tabular mt-2 text-2xl font-semibold tracking-tight",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-destructive"
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export function DescriptionList({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 break-words text-sm">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Mono({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{children}</code>;
}
