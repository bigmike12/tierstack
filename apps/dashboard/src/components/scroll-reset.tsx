"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Next.js restores window scroll, but this app scrolls inside a nested `main`.
 * Reset that container on route/query changes so list pages do not open at a
 * stale offset from the previous screen.
 *
 * With one exception: params named `*Page` drive a table inside a card, and
 * those are deliberately ignored. Paging the emails table at the foot of the
 * dunning screen would otherwise fling the reader back to the top of the page,
 * away from the thing they just clicked — the one navigation on this app where
 * staying put is the correct behaviour. Whole-page tables keep the plain `page`
 * param and still reset, which is what you want when the entire screen changes
 * underneath you.
 */
export function ScrollReset({ containerId }: { containerId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // The identity of "where we are", ignoring in-card paging. Sorted so the
  // same view never produces two different keys because of param order.
  const location = useMemo(() => {
    const significant = new URLSearchParams();
    for (const [key, value] of searchParams.entries()) {
      if (!key.endsWith("Page")) significant.append(key, value);
    }
    significant.sort();
    return `${pathname}?${significant.toString()}`;
  }, [pathname, searchParams]);

  useEffect(() => {
    const node = document.getElementById(containerId);
    if (!node) return;
    node.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [containerId, location]);

  return null;
}
