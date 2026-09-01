import type { Metadata } from "next";
import { Bricolage_Grotesque, IBM_Plex_Mono, Public_Sans } from "next/font/google";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

// Read from configuration rather than written in, so a white-label deployment
// or a second brand is an environment variable rather than a code change.
const appName = process.env.NEXT_PUBLIC_APP_NAME ?? process.env.APP_NAME ?? "Tierstack";

// Three roles, three faces: Public Sans carries the actual UI (nav, tables,
// forms — the workhorse), Bricolage Grotesque gives headings personality,
// IBM Plex Mono carries invoice numbers, ids and every tabular figure.
const publicSans = Public_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: appName, template: `%s · ${appName}` },
  description: "Billing, subscription and payment orchestration for African software businesses.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`h-full ${publicSans.variable} ${bricolage.variable} ${plexMono.variable}`}
    >
      <body className="h-full min-h-dvh font-sans antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
