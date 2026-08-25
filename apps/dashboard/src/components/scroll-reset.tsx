"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Next.js restores window scroll, but this app scrolls inside a nested `main`.
 * Reset that container on route/query changes so list pages do not open at a
 * stale offset from the previous screen.
 */
export function ScrollReset({ containerId }: { containerId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const node = document.getElementById(containerId);
    if (!node) return;
    node.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [containerId, pathname, searchParams]);

  return null;
}
