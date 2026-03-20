import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/login", "/signup"],
        disallow: ["/dashboard", "/profile", "/leagues", "/matches", "/leaderboard"],
      },
    ],
    sitemap: "https://mulligan-league-app.vercel.app/sitemap.xml",
  }
}
