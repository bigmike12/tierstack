import type { Config } from "tailwindcss";

/**
 * The portal is a customer's page, not an operator's console, so it does not
 * share the dashboard's theme. It is deliberately plain: a customer arriving
 * from a "your payment failed" email wants to read one number and press one
 * button, and every additional colour is an opportunity to look like phishing.
 */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#16181d",
        muted: "#6b7280",
        line: "#e5e7eb",
        surface: "#ffffff",
        canvas: "#f6f7f9",
        danger: "#b42318",
        warn: "#b54708",
        good: "#067647",
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "Helvetica", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
