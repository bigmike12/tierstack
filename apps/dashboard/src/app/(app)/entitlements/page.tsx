import type { Metadata } from "next";
import { Mono, NotBuiltYet, PageHeader } from "@/components/ui/shell";

export const metadata: Metadata = { title: "Entitlements" };

export default function EntitlementsPage() {
  return (
    <>
      <PageHeader title="Entitlements" />
      <NotBuiltYet
        title="Entitlement engine"
        phase="Phase 2 · build step 9"
        description="The feature-access check that your application calls before letting a customer export a PDF or spend a token is not implemented yet. It is the next thing to build."
        whatWorks={
          <div className="space-y-3">
            <p>What already exists today:</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                The <Mono>Entitlement</Mono> table, keyed by feature and attachable to a plan, a customer or a
                single subscription.
              </li>
              <li>
                Feature flags on a plan (<Mono>plan.features</Mono>), which the engine will read.
              </li>
              <li>
                The access rule itself — <Mono>hasServiceAccess</Mono> in the billing package — including the
                distinction that a never-paid subscription grants nothing regardless of your grace policy.
              </li>
            </ul>
          </div>
        }
      />
    </>
  );
}
