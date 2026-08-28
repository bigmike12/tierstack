import type { Config } from "tailwindcss";

/**
 * Flat colour only — no gradient anywhere in this file, and none in the pages.
 * A gradient is what a page reaches for when it has nothing to say; this one
 * gets its depth from contrast, whitespace and a single warm accent.
 */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F6F4F0",
        ink: "#14161A",
        muted: "#6B6E76",
        line: "#E3DED4",
        accent: "#C4502B",
        settled: "#16785C",
        pending: "#B4741C",
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      letterSpacing: {
        tightest: "-0.045em",
      },
      maxWidth: {
        readable: "62ch",
      },
    },
  },
  plugins: [],
} satisfies Config;
