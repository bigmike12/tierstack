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

// The same five values Tailwind resolves for paper, ink, muted, line and
// accent. They have to be repeated as literals because ImageResponse renders
// outside the document and never sees the stylesheet — so when the palette
// moves, this is the one file that does not follow on its own.
const PAPER = "#fafafa";
const INK = "#171718";
const MUTED = "#78787a";
const LINE = "#e2e2e3";
const ACCENT = "#297373";

/**
 * Fonts have to be handed to ImageResponse as bytes: the card is rendered
 * outside the document, so it never sees the stylesheet and `next/font` has no
 * part in it.
 *
 * Three faces rather than one, because supplying any font replaces the
 * renderer's built-in default for everything on the card. Asking only for the
 * wordmark face would set the headline in it too — which is the one thing this
 * change is not supposed to do. So the body text is pinned explicitly to Inter
 * and the wordmark alone gets Bricolage.
 *
 * `spec` is `family:weight`; one request each, because a multi-weight response
 * has to be split back apart to know which face is which.
 */
const FACES = [
  { name: "Inter", spec: "Inter:wght@400", weight: 400 as const },
  { name: "Inter", spec: "Inter:wght@600", weight: 600 as const },
  { name: "Bricolage Grotesque", spec: "Bricolage+Grotesque:opsz,wght@12..96,600", weight: 600 as const },
];

async function loadFace(spec: string): Promise<ArrayBuffer> {
  const css = await fetch(`https://fonts.googleapis.com/css2?family=${spec}`, {
    // Google serves woff2 only to a user agent it recognises, and hands
    // everyone else a format the renderer cannot read.
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
  }).then((response) => response.text());

  const url = /src:\s*url\((https:[^)]+)\)/.exec(css)?.[1];
  if (!url) throw new Error(`No font file in the stylesheet for ${spec}`);

  return fetch(url).then((response) => response.arrayBuffer());
}

/**
 * All three or none: a build machine without network access should produce the
 * card in the renderer's default face, not fail to produce one and not produce
 * a half-set one.
 */
let fontsPromise:
  | Promise<
      | {
          name: string;
          data: ArrayBuffer;
          weight: number;
          style: "normal";
        }[]
      | undefined
    >
  | null = null;

async function loadFonts() {
  if (!fontsPromise) {
    fontsPromise = (async () => {
      try {
        const files = await Promise.all(FACES.map((face) => loadFace(face.spec)));
        return FACES.map((face, index) => ({
          name: face.name,
          data: files[index]!,
          weight: face.weight,
          style: "normal" as const,
        }));
      } catch {
        return undefined;
      }
    })();
  }
  return fontsPromise;
}

export default async function OpengraphImage() {
  const fonts = await loadFonts();
  const BODY = fonts ? "Inter" : "Helvetica, Arial, sans-serif";
  const WORDMARK = fonts ? "Bricolage Grotesque" : BODY;

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
          fontFamily: BODY,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="34" height="34" viewBox="0 0 24 24" fill={INK}>
            <rect x="2" y="15" width="20" height="5" rx="1.6" />
            <rect x="4.5" y="9" width="15" height="5" rx="1.6" opacity="0.6" />
            <rect x="7" y="3" width="10" height="5" rx="1.6" opacity="0.32" />
          </svg>
          <span
            style={{
              fontSize: 30,
              fontWeight: 600,
              color: INK,
              letterSpacing: -0.5,
              fontFamily: WORDMARK,
            }}
          >
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
            // Without a gap the two halves of this row meet in the middle and
            // run into each other the moment either string gets any longer.
            gap: 28,
            borderTop: `1px solid ${LINE}`,
            paddingTop: 26,
          }}
        >
          <span style={{ fontSize: 21, color: MUTED }}>
            Subscriptions · invoices · failed-payment recovery · usage billing
          </span>
          <span
            style={{
              fontSize: 18,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: MUTED,
              whiteSpace: "nowrap",
            }}
          >
            For African software
          </span>
        </div>
      </div>
    ),
    { ...size, fonts }
  );
}
