import { ImageResponse } from "next/og";
import { BRAND } from "@/brand";

/**
 * The card that appears when somebody pastes a link into WhatsApp.
 *
 * Generated from BRAND rather than exported from a design tool, which is the
 * whole point: the name is not settled, and this way the card follows it. Edit
 * brand.ts and the preview changes on the next build — there is no second file
 * anywhere holding a stale version of the name.
 *
 * Kept to flat colour and type because ImageResponse supports a subset of CSS,
 * and because the site itself has no gradients in it.
 */
export const runtime = "nodejs";
export const alt = `${BRAND.name} — ${BRAND.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PAPER = "#F6F4F0";
const INK = "#14161A";
const MUTED = "#6B6E76";
const LINE = "#E3DED4";
const ACCENT = "#C4502B";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: PAPER,
          padding: "72px 80px",
          fontFamily: "Helvetica, Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="34" height="34" viewBox="0 0 24 24" fill={INK}>
            <rect x="2" y="15" width="20" height="5" rx="1.6" />
            <rect x="4.5" y="9" width="15" height="5" rx="1.6" opacity="0.6" />
            <rect x="7" y="3" width="10" height="5" rx="1.6" opacity="0.32" />
          </svg>
          <span style={{ fontSize: 30, fontWeight: 600, color: INK, letterSpacing: -0.5 }}>
            {BRAND.name}
          </span>
          <span
            style={{
              marginLeft: 14,
              fontSize: 17,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: ACCENT,
            }}
          >
            Billing infrastructure
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <span
            style={{
              fontSize: 68,
              fontWeight: 600,
              lineHeight: 1.08,
              letterSpacing: -2.4,
              color: INK,
              maxWidth: 960,
            }}
          >
            {BRAND.claim}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: `1px solid ${LINE}`,
            paddingTop: 26,
          }}
        >
          <span style={{ fontSize: 24, color: MUTED }}>
            Subscriptions · invoices · failed-payment recovery · usage billing
          </span>
          <span style={{ fontSize: 21, letterSpacing: 2, textTransform: "uppercase", color: MUTED }}>
            For African software
          </span>
        </div>
      </div>
    ),
    size
  );
}
