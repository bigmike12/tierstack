"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { useToast } from "@/components/ui/toast";

/**
 * Fires a toast for a message that had to survive a redirect — a server
 * action can't call useToast() itself, so it flags the outcome on the URL
 * (`?done=1`) and the destination page renders this to pick it up. Strips the
 * param immediately after so refreshing or sharing the link never re-fires it.
 */
export function ToastFlash({
  param,
  value = "1",
  title,
  description,
  variant = "success",
}: {
  param: string;
  value?: string;
  title: string;
  description?: string;
  variant?: "success" | "error" | "info";
}) {
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    if (searchParams.get(param) !== value) return;
    fired.current = true;

    toast({ title, description, variant });

    const next = new URLSearchParams(searchParams.toString());
    next.delete(param);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    // Deliberately runs once: re-running on every searchParams change would
    // refire the moment the router.replace below removes the flag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
