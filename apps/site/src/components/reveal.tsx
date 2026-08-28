"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Shows its children once, when they first come into view.
 *
 * One observer per element, disconnected the moment it fires — the effect is
 * meant to be noticed and then forgotten, not to re-run every time somebody
 * scrolls back up. If the browser has no IntersectionObserver, or the reader
 * has asked for reduced motion, the content is simply already visible.
 */
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (typeof IntersectionObserver === "undefined") {
      node.dataset.shown = "true";
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          window.setTimeout(() => {
            node.dataset.shown = "true";
          }, delay);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.1 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [delay]);

  return (
    <div ref={ref} data-shown="false" className={`reveal ${className}`}>
      {children}
    </div>
  );
}
