import type { MetadataRoute } from "next";

import { ROUTES, SITE_URL } from "@/lib/site";

// `output: "export"` builds every route ahead of time, so this metadata
// route has to be marked static explicitly or the build refuses it.
export const dynamic = "force-static";

/** Emitted as /sitemap.xml at build time (the app is a static export). */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return ROUTES.map((path) => ({
    url: `${SITE_URL}${path === "/" ? "" : path}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: path === "/" ? 1 : 0.8,
  }));
}
