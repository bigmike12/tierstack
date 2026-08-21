import type { Metadata } from "next";
import { Mono, NotBuiltYet, PageHeader } from "@/components/ui/shell";

export const metadata: Metadata = { title: "Usage" };

export default function UsagePage() {
  return (
    <>
      <PageHeader title="Usage" />
      <NotBuiltYet
        title="Usage metering"
        phase="Phase 2 · build step 10"
        description="Meters, event ingestion, aggregation, included quota and overage are not implemented in this build. Rather than show an empty chart that reads as “no usage yet”, this page says plainly that the engine behind it does not exist."
        whatWorks={
          <div className="space-y-3">
            <p>What already exists today:</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                The <Mono>UsageMeter</Mono> and <Mono>UsageEvent</Mono> tables, including the unique
                constraint on organization + event id that makes ingestion idempotent.
              </li>
              <li>
                Usage-metered and hybrid prices can be created and listed, so your catalogue can be modelled
                before the engine lands.
              </li>
              <li>
                Subscribing to one of those prices returns <Mono>NOT_IMPLEMENTED</Mono> — the engine refuses
                rather than issuing an invoice that silently omits the metered charge.
              </li>
            </ul>
          </div>
        }
      />
    </>
  );
}
