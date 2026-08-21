import type { Metadata } from "next";
import "./globals.css";

// The product name is not decided. It comes from configuration so the eventual
// brand is a single environment variable away.
const appName = process.env.NEXT_PUBLIC_APP_NAME ?? process.env.APP_NAME ?? "Billing Platform";

export const metadata: Metadata = {
  title: { default: appName, template: `%s · ${appName}` },
  description: "Billing, subscription and payment orchestration.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
