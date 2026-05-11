/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Default is 60s. Keep brand assets fresh for new visitors so a logo swap
    // ships within an hour instead of clients seeing stale builds for days.
    minimumCacheTTL: 300,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "abizphozurvgdjljwvfx.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  // Brand assets live at stable URLs in /public, so Vercel's edge would cache
  // them for ages. That breaks the rebrand workflow: clients with the app
  // saved to their home screen see the old logo for days after a push.
  // Force a no-store revalidate on the few files that actually change in place.
  async headers() {
    return [
      {
        source: "/:asset(logo|logo-mark|favicon)\\.:ext(png|ico)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, s-maxage=300, must-revalidate",
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig
