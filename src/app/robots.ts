import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/"],
        disallow: ["/home", "/profile", "/games", "/matches", "/leaderboard", "/players", "/notifications"],
      },
    ],
    sitemap: "https://app.mulliganclub.co/sitemap.xml",
  }
}
