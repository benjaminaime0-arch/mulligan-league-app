import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { supabaseAnonServer } from "@/lib/supabaseServer"
import { MyCourseStats } from "./MyCourseStats"

/**
 * /courses/[slug] — one course's public page (Phase F): header facts, the
 * full hole-by-hole card, a maps link, the signup CTA, and — for a signed-in
 * viewer who has played it — their personal record (client island).
 *
 * Server component + force-dynamic for the same CI-build reason as /courses.
 */
export const dynamic = "force-dynamic"

type CourseRow = {
  id: string
  slug: string
  name: string
  city: string | null
  postcode: string | null
  department: string | null
  dept_no: string | null
  holes: number | null
  par: number | null
  dist_white: number | null
  dist_yellow: number | null
  dist_red: number | null
  course_type: string | null
  access: string | null
}
type HoleRow = {
  hole_number: number
  par: number
  hcp_index: number | null
  dist_yellow_m: number | null
  tee_note: string | null
}

async function fetchCourse(slug: string): Promise<{ course: CourseRow; holes: HoleRow[] } | null> {
  try {
    const sb = supabaseAnonServer()
    const { data: course } = await sb
      .from("courses")
      .select(
        "id, slug, name, city, postcode, department, dept_no, holes, par, dist_white, dist_yellow, dist_red, course_type, access",
      )
      .eq("slug", slug)
      .maybeSingle()
    if (!course) return null
    const { data: holes } = await sb
      .from("course_holes")
      .select("hole_number, par, hcp_index, dist_yellow_m, tee_note")
      .eq("course_id", (course as CourseRow).id)
      .order("hole_number")
    return { course: course as CourseRow, holes: (holes ?? []) as HoleRow[] }
  } catch {
    return null
  }
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string }
}): Promise<Metadata> {
  const res = await fetchCourse(params.slug)
  if (!res) return { title: "Parcours introuvable | Mulligan" }
  const { course } = res
  const facts = [
    course.holes ? `${course.holes} trous` : null,
    course.par ? `par ${course.par}` : null,
    course.city,
  ]
    .filter(Boolean)
    .join(", ")
  return {
    title: `${course.name} — carte de score et infos | Mulligan`,
    description: `${course.name} (${facts}) : carte de score trou par trou, distances et index. Organisez votre ligue entre amis sur ce parcours avec Mulligan.`,
    alternates: { canonical: `https://app.mulliganclub.co/courses/${course.slug}` },
  }
}

export default async function CoursePage({ params }: { params: { slug: string } }) {
  const res = await fetchCourse(params.slug)
  if (!res) notFound()
  const { course, holes } = res
  const tee = holes.find((h) => h.tee_note)?.tee_note

  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${course.name} ${course.city ?? ""}`,
  )}`

  const out = holes.filter((h) => h.hole_number <= 9)
  const back = holes.filter((h) => h.hole_number > 9)

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-10">
      <nav className="text-sm text-primary/50">
        <Link href="/courses" className="hover:underline">
          Golfs d&apos;Île-de-France
        </Link>{" "}
        / {course.name}
      </nav>

      <header className="mt-3">
        <h1 className="text-3xl font-bold text-primary">{course.name}</h1>
        <p className="mt-1 text-primary/70">
          {[
            course.city && `${course.city}${course.postcode ? ` (${course.postcode})` : ""}`,
            course.department,
            course.course_type,
            course.access,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          {course.holes != null && (
            <span className="rounded-full bg-cream px-3 py-1 font-medium text-primary">
              {course.holes} trous
            </span>
          )}
          {course.par != null && (
            <span className="rounded-full bg-cream px-3 py-1 font-medium text-primary">
              Par {course.par}
            </span>
          )}
          {course.dist_yellow != null && (
            <span className="rounded-full bg-cream px-3 py-1 font-medium text-primary">
              {course.dist_yellow} m (jaunes)
            </span>
          )}
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-primary/20 px-3 py-1 font-medium text-primary hover:bg-cream"
          >
            Voir sur la carte ↗
          </a>
        </div>
      </header>

      {holes.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-xl font-bold text-primary">
            Carte de score{tee ? ` (départs ${tee}s)` : " (départs jaunes)"}
          </h2>
          <div className="mt-3 overflow-x-auto rounded-xl border border-primary/15 bg-white">
            {[out, back]
              .filter((half) => half.length > 0)
              .map((half, i) => (
                <table key={i} className="w-full min-w-[28rem] text-sm tabular-nums">
                  <thead>
                    <tr className="border-b border-primary/10 text-left text-primary/50">
                      <th className="px-3 py-2 font-medium">Trou</th>
                      {half.map((h) => (
                        <th key={h.hole_number} className="px-2 py-2 text-center font-medium">
                          {h.hole_number}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-center font-medium">
                        {i === 0 && back.length > 0 ? "Aller" : back.length > 0 ? "Retour" : "Total"}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="text-primary">
                    <tr className="border-b border-primary/5">
                      <td className="px-3 py-2 font-medium text-primary/60">Par</td>
                      {half.map((h) => (
                        <td key={h.hole_number} className="px-2 py-2 text-center">
                          {h.par}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-center font-semibold">
                        {half.reduce((s, h) => s + h.par, 0)}
                      </td>
                    </tr>
                    <tr className="border-b border-primary/5">
                      <td className="px-3 py-2 font-medium text-primary/60">Index</td>
                      {half.map((h) => (
                        <td key={h.hole_number} className="px-2 py-2 text-center">
                          {h.hcp_index ?? "–"}
                        </td>
                      ))}
                      <td className="px-3 py-2" />
                    </tr>
                    <tr>
                      <td className="px-3 py-2 font-medium text-primary/60">m</td>
                      {half.map((h) => (
                        <td key={h.hole_number} className="px-2 py-2 text-center">
                          {h.dist_yellow_m ?? "–"}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-center font-semibold">
                        {half.reduce((s, h) => s + (h.dist_yellow_m ?? 0), 0) || "–"}
                      </td>
                    </tr>
                  </tbody>
                </table>
              ))}
          </div>
        </section>
      ) : (
        <p className="mt-8 text-primary/60">
          La carte trou par trou de ce parcours n&apos;est pas encore référencée.
        </p>
      )}

      {/* Signed-in viewer's record on this course — renders nothing when
          logged out or never played (client island; the page stays static
          HTML for crawlers either way). */}
      <MyCourseStats courseId={course.id} coursePar={course.par} courseHoles={course.holes} />

      <section className="mt-10 rounded-xl bg-primary p-6 text-center text-cream">
        <h2 className="text-lg font-bold">Créez votre ligue sur ce parcours</h2>
        <p className="mt-1 text-sm opacity-80">
          Parties entre amis, cartes trou par trou, classement en direct — gratuit.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block rounded-lg bg-cream px-5 py-2.5 font-semibold text-primary"
        >
          Commencer sur Mulligan
        </Link>
      </section>
    </main>
  )
}
