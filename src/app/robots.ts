import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  // Let crawlers read page-level noindex on authentication/private app routes.
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }], sitemap: "https://app.mulliganclub.co/sitemap.xml" }
}
