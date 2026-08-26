export default function ExpiredPage() {
  return (
    <main className="rounded-lg border border-line bg-surface p-6">
      <h1 className="text-lg font-semibold">This link has expired</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Billing links are short-lived on purpose, so one sitting in an old email cannot be used later.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Ask for a new one and it will work straight away. If you were paying an overdue invoice, nothing has
        been charged.
      </p>
    </main>
  );
}
