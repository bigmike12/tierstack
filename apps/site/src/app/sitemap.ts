import type { MetadataRoute } from "next";
import { BRAND } from "@/brand";
import { ALL_PAGES } from "@/docs/content";

/**
 * Generated, not maintained.
 *
 * The marketing routes are listed once below; every documentation page comes
 * from the same content file the pages themselves render from, so adding a doc
 * page adds it to the sitemap and there is no second list to forget.
 */
const MARKETING: Array<{ path: string; priority: number }> = [
  { path: "/", priority: 1 },
  { path: "/how-it-works", priority: 0.9 },
  { path: "/features", priority: 0.9 },
  { path: "/developers", priority: 0.9 },
  { path: "/status", priority: 0.7 },
  { path: "/docs", priority: 0.8 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const url = (path: string) => new URL(path, BRAND.siteUrl).toString();

  return [
    ...MARKETING.map((entry) => ({
      url: url(entry.path),
      lastModified,
      changeFrequency: "monthly" as const,
      priority: entry.priority,
    })),
    ...ALL_PAGES.map((page) => ({
      url: url(`/docs/${page.slug}`),
      lastModified,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
