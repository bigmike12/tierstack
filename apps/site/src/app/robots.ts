import type { MetadataRoute } from "next";
import { BRAND } from "@/brand";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: new URL("/sitemap.xml", BRAND.siteUrl).toString(),
  };
}
