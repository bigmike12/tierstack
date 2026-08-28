import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Billing",
  description: "Manage your subscription and payments.",
  // A billing page has no business being indexed.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans antialiased">
        <div className="mx-auto w-full max-w-2xl px-5 py-10 sm:py-14">{children}</div>
      </body>
    </html>
  );
}
