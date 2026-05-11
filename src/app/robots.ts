import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/"],
        disallow: ["/dashboard", "/profile", "/leagues", "/matches", "/leaderboard"],
      },
    ],
    sitemap: "https://app.mulliganclub.co/sitemap.xml",
  }
}
