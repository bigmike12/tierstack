import type { Metadata } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import { BRAND } from "@/brand";
import { Footer, Nav } from "@/components/chrome";
import "./globals.css";

/**
 * One webfont on the whole site, carrying one word.
 *
 * The wordmark is the only place the brand face appears, so only the weight it
 * is set in is downloaded — a single 600 cut rather than the full variable
 * range. `display: "swap"` means the name renders in the system stack for the
 * few hundred milliseconds before it arrives instead of leaving a hole in the
 * nav, and `adjustFontFallback` keeps that swap from shifting the layout.
 */
const wordmark = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600"],
  variable: "--font-wordmark",
  display: "swap",
});

const DESCRIPTION =
  "Subscriptions, invoices, failed-payment recovery, price changes and usage billing — the billing layer between your application and Paystack, so you do not build any of it yourself.";

export const metadata: Metadata = {
  // Without this, every Open Graph and Twitter path resolves relative and no
  // scraper can follow it: the link renders on WhatsApp and Slack as a bare
  // URL with no title, no image and no description.
  metadataBase: new URL(BRAND.siteUrl),
  title: {
    default: `${BRAND.name} — billing infrastructure for African software`,
    template: `%s — ${BRAND.name}`,
  },
  description: DESCRIPTION,
  applicationName: BRAND.name,
  openGraph: {
    type: "website",
    siteName: BRAND.name,
    title: `${BRAND.name} — billing infrastructure for African software`,
    description: DESCRIPTION,
    url: "/",
    locale: "en_NG",
  },
  twitter: {
    card: "summary_large_image",
    title: `${BRAND.name} — billing infrastructure for African software`,
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={wordmark.variable}>
      <body className="min-h-dvh font-sans antialiased">
        <Nav />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
