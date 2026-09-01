import type { Config } from "tailwindcss";

/**
 * Colours are declared as CSS variables in globals.css and referenced here, so
 * the brand palette is a one-file change and nothing in the components
 * hard-codes a hex value. The five raw families below are the exception —
 * available directly for the rare component that needs a specific shade
 * beyond the ten semantic roles (charts, decorative accents). Everything else
 * should reach for the semantic tokens first.
 */
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        card: "hsl(var(--card) / <alpha-value>)",
        "card-foreground": "hsl(var(--card-foreground) / <alpha-value>)",
        muted: "hsl(var(--muted) / <alpha-value>)",
        "muted-foreground": "hsl(var(--muted-foreground) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        ring: "hsl(var(--ring) / <alpha-value>)",
        primary: "hsl(var(--primary) / <alpha-value>)",
        "primary-foreground": "hsl(var(--primary-foreground) / <alpha-value>)",
        secondary: "hsl(var(--secondary) / <alpha-value>)",
        "secondary-foreground": "hsl(var(--secondary-foreground) / <alpha-value>)",
        destructive: "hsl(var(--destructive) / <alpha-value>)",
        "destructive-foreground": "hsl(var(--destructive-foreground) / <alpha-value>)",
        success: "hsl(var(--success) / <alpha-value>)",
        "success-foreground": "hsl(var(--success-foreground) / <alpha-value>)",
        warning: "hsl(var(--warning) / <alpha-value>)",
        "warning-foreground": "hsl(var(--warning-foreground) / <alpha-value>)",

        aquamarine: {
          DEFAULT: "#85ffc7",
          100: "#004e29",
          200: "#009b53",
          300: "#00e97c",
          400: "#37ffa2",
          500: "#85ffc7",
          600: "#9dffd1",
          700: "#b6ffdd",
          800: "#ceffe8",
          900: "#e7fff4",
        },
        pine_blue: {
          DEFAULT: "#297373",
          100: "#081717",
          200: "#112e2e",
          300: "#194646",
          400: "#225d5d",
          500: "#297373",
          600: "#3da8a8",
          700: "#64c7c7",
          800: "#98dada",
          900: "#cbecec",
        },
        coral_glow: {
          DEFAULT: "#ff8552",
          100: "#431400",
          200: "#872800",
          300: "#ca3d00",
          400: "#ff560e",
          500: "#ff8552",
          600: "#ff9e74",
          700: "#ffb697",
          800: "#ffceba",
          900: "#ffe7dc",
        },
        alabaster_grey: {
          DEFAULT: "#e6e6e6",
          100: "#2e2e2e",
          200: "#5c5c5c",
          300: "#8a8a8a",
          400: "#b8b8b8",
          500: "#e6e6e6",
          600: "#ebebeb",
          700: "#f0f0f0",
          800: "#f5f5f5",
          900: "#fafafa",
        },
        graphite: {
          DEFAULT: "#39393a",
          100: "#0c0c0c",
          200: "#171718",
          300: "#232324",
          400: "#2e2e2f",
          500: "#39393a",
          600: "#616163",
          700: "#88888a",
          800: "#b0b0b1",
          900: "#d7d7d8",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "ui-sans-serif", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
