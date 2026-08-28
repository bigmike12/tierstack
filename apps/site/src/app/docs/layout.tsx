import type { Metadata } from "next";
import { BRAND } from "@/brand";
import { DocsNav } from "@/components/docs-nav";

export const metadata: Metadata = {
  title: { default: "Documentation", template: `%s — ${BRAND.name} docs` },
  description:
    "The Tierstack HTTP API: authentication, idempotency, customers, plans and prices, subscriptions, invoices, payments, entitlements, usage metering and the customer portal.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 pb-24 pt-10 sm:pt-14">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] lg:gap-16">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <DocsNav />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
