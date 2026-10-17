import type { MetadataRoute } from "next"
import { supabaseAnonServer } from "@/lib/supabaseServer"

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = "https://app.mulliganclub.co"

  const fixed: MetadataRoute.Sitemap = [{ url: `${baseUrl}/courses` }]

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
      })),
    ]
  } catch {
    return fixed
  }
}
