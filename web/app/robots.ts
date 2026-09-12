import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

// `output: "export"` builds every route ahead of time, so this metadata
// route has to be marked static explicitly or the build refuses it.
export const dynamic = "force-static";

/** Emitted as /robots.txt at build time (the app is a static export). */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
