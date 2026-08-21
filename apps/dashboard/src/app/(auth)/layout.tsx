const appName = process.env.NEXT_PUBLIC_APP_NAME ?? process.env.APP_NAME ?? "Billing Platform";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </main>

      <aside className="hidden border-l border-border bg-muted/40 px-12 py-16 lg:flex lg:flex-col lg:justify-center">
        <div className="max-w-md">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{appName}</p>
          <h2 className="mt-4 text-2xl font-semibold leading-snug tracking-tight">
            Your billing logic, defined once.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Plans, subscriptions, invoices, entitlements and payment recovery live here — not inside a
            payment provider. Paystack, Monnify and Flutterwave are rails underneath, and swapping one
            costs you no history.
          </p>
          <dl className="mt-10 space-y-4 text-sm">
            {[
              ["Provider-agnostic", "Adding a rail is a new adapter, not a rewrite of the billing engine."],
              ["Your policy, not ours", "Grace periods, retry schedules and failure actions are yours to configure."],
              ["Runs with no credentials", "The mock rail gives you the whole lifecycle locally."],
            ].map(([title, body]) => (
              <div key={title} className="flex gap-3">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground/40" />
                <div>
                  <dt className="font-medium">{title}</dt>
                  <dd className="text-muted-foreground">{body}</dd>
                </div>
              </div>
            ))}
          </dl>
        </div>
      </aside>
    </div>
  );
}
