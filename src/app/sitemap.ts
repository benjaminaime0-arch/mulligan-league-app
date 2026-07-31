import type { MetadataRoute } from "next"
import { supabaseAnonServer } from "@/lib/supabaseServer"

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = "https://app.mulliganclub.co"

  const fixed: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${baseUrl}/courses`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/terms`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ]

  // Course pages (Phase F). Guarded: a CI build with dummy env still
  // produces the fixed part of the sitemap.
  try {
    const { data } = await supabaseAnonServer()
      .from("courses")
      .select("slug")
      .not("slug", "is", null)
    return [
      ...fixed,
      ...((data ?? []) as { slug: string }[]).map((c) => ({
        url: `${baseUrl}/courses/${c.slug}`,
        lastModified: new Date(),
        changeFrequency: "monthly" as const,
        priority: 0.6,
      })),
    ]
  } catch {
    return fixed
  }
}
