import type { Metadata } from "next";
import { Mono, NotBuiltYet, PageHeader } from "@/components/ui/shell";

export const metadata: Metadata = { title: "Referrals" };

export default function ReferralsPage() {
  return (
    <>
      <PageHeader title="Referrals" />
      <NotBuiltYet
        title="Referrals and credit"
        phase="Phase 6 · build step 19"
        description="Referral programmes, qualification triggers and reward settlement are not implemented. The ledger they will write into is, however, already designed."
        whatWorks={
          <div className="space-y-3">
            <p>What already exists today:</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <Mono>ReferralProgram</Mono> and <Mono>Referral</Mono> tables, with configurable reward type,
                amount and qualification trigger.
              </li>
              <li>
                An immutable <Mono>CreditLedgerEntry</Mono> table. Balance is derived by summing entries —
                there is no mutable wallet figure to drift out of step with reality.
              </li>
              <li>
                A <Mono>CREDIT</Mono> invoice line type for when credit is applied against a bill.
              </li>
            </ul>
          </div>
        }
      />
    </>
  );
}
