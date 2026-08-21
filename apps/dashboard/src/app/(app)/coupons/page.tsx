import type { Metadata } from "next";
import { Mono, NotBuiltYet, PageHeader } from "@/components/ui/shell";

export const metadata: Metadata = { title: "Coupons" };

export default function CouponsPage() {
  return (
    <>
      <PageHeader title="Coupons" />
      <NotBuiltYet
        title="Coupons and discounts"
        phase="Phase 6 · build step 19"
        description="Percentage and fixed-amount coupons, redemption limits and per-customer caps are not implemented. Growth features come after the billing core is reliable, deliberately."
        whatWorks={
          <div className="space-y-3">
            <p>What already exists today:</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                The <Mono>Coupon</Mono> and <Mono>CouponRedemption</Mono> tables, including the currency
                column that will stop an NGN coupon being applied to a USD invoice.
              </li>
              <li>
                A <Mono>COUPON</Mono> invoice line type, so a discount will appear as its own line rather
                than quietly reducing the subtotal.
              </li>
              <li>
                Invoice totals already handle negative lines, so the arithmetic will not need revisiting.
              </li>
            </ul>
          </div>
        }
      />
    </>
  );
}
