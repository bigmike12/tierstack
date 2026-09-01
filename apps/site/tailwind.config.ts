import type { Config } from "tailwindcss";

/**
 * Flat colour only — no gradient anywhere in this file, and none in the pages.
 * A gradient is what a page reaches for when it has nothing to say; this one
 * gets its depth from contrast, whitespace and a single warm accent.
 *
 * Same seven roles as before, now drawn from the Tierstack palette so the
 * marketing site and the dashboard read as one product: paper/ink/muted/line
 * match the dashboard's background/foreground/muted-foreground/border, accent
 * is the same pine_blue used for every primary action there, and settled /
 * pending are the same aquamarine / coral_glow used for success and warning.
 */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#fafafa",
        ink: "#171718",
        muted: "#78787a",
        line: "#e2e2e3",
        accent: "#297373",
        "accent-hover": "#3da8a8",
        settled: "#00834a",
        pending: "#ca3d00",
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
