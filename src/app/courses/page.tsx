import type { Metadata } from "next"
import Link from "next/link"
import { supabaseAnonServer } from "@/lib/supabaseServer"

/**
 * /courses — public directory of the Île-de-France referential (Phase F).
 *
 * SERVER component, unlike the rest of the app: these pages exist for
 * Google and must render full HTML to anonymous crawlers. French copy is
 * hardcoded (the client i18n provider doesn't run here; new screens are
 * French-first by product rule).
 *
 * force-dynamic on purpose: CI builds run with a dummy Supabase URL, so
 * build-time prerendering would bake an empty page (ISR would serve it for
 * a day). SSR-per-request is nothing at 129 rows and keeps the page always
 * fresh + always crawlable.
 */
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Golfs d'Île-de-France — annuaire des parcours",
  description:
    "Les parcours de golf d'Île-de-France : trous, par, distances et cartes de score. Créez votre ligue entre amis sur votre parcours avec Mulligan.",
  alternates: { canonical: "https://app.mulliganclub.co/courses" },
}

type CourseRow = {
  id: string
  slug: string | null
  name: string
  city: string | null
  dept_no: string | null
  department: string | null
  holes: number | null
  par: number | null
  course_type: string | null
}

const DEPT_ORDER = ["75", "77", "78", "91", "92", "93", "94", "95"]

export default async function CoursesPage() {
  let courses: CourseRow[] = []
  try {
    const { data } = await supabaseAnonServer()
      .from("courses")
      .select("id, slug, name, city, dept_no, department, holes, par, course_type")
      .not("slug", "is", null)
      .order("name")
    courses = (data ?? []) as CourseRow[]
  } catch {
    // Rendered empty (e.g. CI build probe) — real traffic re-renders per request.
  }

  const byDept = new Map<string, CourseRow[]>()
  for (const c of courses) {
    const d = c.dept_no ?? "??"
    byDept.set(d, [...(byDept.get(d) ?? []), c])
  }
  const depts = DEPT_ORDER.filter((d) => byDept.has(d)).concat(
    Array.from(byDept.keys()).filter((d) => !DEPT_ORDER.includes(d)),
  )

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-10">
      <header>
        <h1 className="text-3xl font-bold text-primary">Golfs d&apos;Île-de-France</h1>
        <p className="mt-2 text-primary/70">
          {courses.length} parcours référencés — trous, par, distances et cartes de
          score trou par trou.
        </p>
        <nav aria-label="Départements" className="mt-4 flex flex-wrap gap-2">
          {depts.map((d) => (
            <a
              key={d}
              href={`#dept-${d}`}
              className="rounded-full border border-primary/20 px-3 py-1 text-sm text-primary hover:bg-cream"
            >
              {byDept.get(d)?.[0]?.department ?? d} ({d})
            </a>
          ))}
        </nav>
      </header>

      {depts.map((d) => (
        <section key={d} id={`dept-${d}`} className="mt-10">
          <h2 className="text-xl font-bold text-primary">
            {byDept.get(d)?.[0]?.department ?? "Département"} ({d})
          </h2>
          <ul className="mt-3 divide-y divide-primary/10 rounded-xl border border-primary/15 bg-white">
            {(byDept.get(d) ?? []).map((c) => (
              <li key={c.id}>
                <Link
                  href={`/courses/${c.slug}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-cream/50"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-primary">{c.name}</span>
                    <span className="block text-sm text-primary/50">
                      {[c.city, c.course_type].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-primary/60">
                    {c.holes ? `${c.holes} trous` : ""}
                    {c.par ? ` · Par ${c.par}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="mt-12 rounded-xl bg-primary p-6 text-center text-cream">
        <h2 className="text-lg font-bold">Votre ligue sur votre parcours</h2>
        <p className="mt-1 text-sm opacity-80">
          Créez une partie entre amis, saisissez vos cartes trou par trou et suivez
          le classement toute la saison.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block rounded-lg bg-cream px-5 py-2.5 font-semibold text-primary"
        >
          Commencer gratuitement
        </Link>
      </section>
    </main>
  )
}
