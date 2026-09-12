/**
 * Canonical origin and the routes worth indexing.
 *
 * Kept in one place so the metadata base, robots.txt, the sitemap and every
 * page's canonical URL cannot drift apart. `/replay` is deliberately absent:
 * it renders an engagement from a `?seed=` query and has nothing to show
 * without one, so it is not a page a crawler should list.
 */
export const SITE_URL = "https://zeromiss-nu.vercel.app";

export const ROUTES = [
  "/",
  "/arena",
  "/fpv",
  "/play",
  "/duel",
  "/compare",
  "/storm",
  "/montecarlo",
  "/tracker",
  "/threed",
  "/learn",
] as const;
