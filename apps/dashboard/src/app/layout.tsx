import type { Metadata } from "next";
import "./globals.css";

// Read from configuration rather than written in, so a white-label deployment
// or a second brand is an environment variable rather than a code change.
const appName = process.env.NEXT_PUBLIC_APP_NAME ?? process.env.APP_NAME ?? "Tierbase";

export const metadata: Metadata = {
  title: { default: appName, template: `%s · ${appName}` },
  description: "Billing, subscription and payment orchestration for African software businesses.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <body className="h-full min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
