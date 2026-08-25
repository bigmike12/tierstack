import { redirect } from "next/navigation";
import Link from "next/link";
import { logoutAction } from "@/actions/session";
import { OrgSwitcher } from "@/components/org-switcher";
import { Sidebar } from "@/components/sidebar";
import { ScrollReset } from "@/components/scroll-reset";
import { Wordmark } from "@/components/wordmark";
import { Button } from "@/components/ui/button";
import { apiFetchOrNull } from "@/lib/api";
import type { Session } from "@/lib/types";

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? process.env.APP_NAME ?? "Tierbase";
const billingEnv = (process.env.BILLING_ENV ?? "test").toUpperCase();

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await apiFetchOrNull<Session>("/v1/auth/me");
  if (!session || session.actor !== "user") redirect("/login");

  const organizations = session.organizations ?? [];
  const current = organizations[0];

  return (
    <div className="flex h-dvh overflow-hidden">
      <div className="hidden w-60 shrink-0 flex-col border-r border-border bg-card/60 md:flex">
        <div className="flex h-14 shrink-0 items-center border-b border-border px-5">
          <Link href="/overview" className="min-w-0 text-sm">
            <Wordmark name={appName} />
          </Link>
        </div>
        {/* Long nav lists scroll within the sidebar rather than pushing the page. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Sidebar />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-5">
          <div className="flex min-w-0 items-center gap-3">
            <OrgSwitcher organizations={organizations} currentId={current?.id ?? ""} />
            <span className="hidden rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:inline">
              {billingEnv}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden truncate text-sm text-muted-foreground sm:inline">
              {session.user?.email}
            </span>
            <form action={logoutAction}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </header>

        <main
          id="app-scroll-container"
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 lg:px-8 lg:py-8"
        >
          <ScrollReset containerId="app-scroll-container" />
          {children}
        </main>
      </div>
    </div>
  );
}
