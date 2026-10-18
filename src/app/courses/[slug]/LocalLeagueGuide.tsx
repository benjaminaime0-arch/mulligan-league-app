import Link from "next/link"
import { AnalyticsView } from "@/components/AnalyticsView"
import { courseLeagueContent, courseLeagueSignupHref } from "@/lib/courseLeagueContent"
import { CourseLeagueCta } from "./CourseLeagueCta"

export function LocalLeagueGuide({ slug, courseId }: { slug: string; courseId: string }) {
  const content = courseLeagueContent[slug]
  if (!content) return null
  return <section className="mt-6 rounded-[20px] border border-primary/15 bg-cream p-5 sm:p-6" aria-labelledby="local-league-title">
    <AnalyticsView event="course_league_viewed" viewKey={slug} params={{ entry_point: content.entry }} />
    <p className="text-xs font-semibold uppercase tracking-wider text-primary/60">Votre groupe. Votre parcours.</p>
    <h2 id="local-league-title" className="mt-2 text-2xl font-bold leading-tight text-primary">Votre ligue de golf entre amis à {content.label}</h2>
    <p className="mt-3 text-sm leading-relaxed text-primary/75">{content.intro}</p>
    <CourseLeagueCta href={courseLeagueSignupHref(courseId, content.entry)} entry={content.entry} label={`Créer ma ligue à ${content.label}`} />
    <ol className="mt-5 grid gap-3 border-t border-primary/15 pt-5 text-sm sm:grid-cols-3">
      <li><strong className="block">01 · Choisissez votre saison</strong><span className="mt-1 block text-xs leading-relaxed text-primary/70">1, 2 ou 3 mois. Stroke play brut, net ou Stableford net.</span></li>
      <li><strong className="block">02 · Invitez votre groupe</strong><span className="mt-1 block text-xs leading-relaxed text-primary/70">Partagez le lien de votre ligue par WhatsApp ou dans votre conversation habituelle.</span></li>
      <li><strong className="block">03 · Lancez la première carte</strong><span className="mt-1 block text-xs leading-relaxed text-primary/70">Saisissez vos scores, puis soumettez votre carte validée à la ligue.</span></li>
    </ol>
    <h3 className="mt-5 text-sm font-bold">Un cadre commun pour vos parties à {content.label}</h3>
    <p className="mt-2 text-sm leading-relaxed text-primary/75">{content.tip}</p>
    <p className="mt-3 text-xs leading-relaxed text-primary/65">Mulligan organise votre classement privé. La réservation du départ et les conditions d’accès se vérifient directement auprès du club. Le niveau interne Mulligan reste distinct de l’index officiel WHS.</p>
    <div className="mt-4 flex flex-col gap-3 text-sm underline underline-offset-4"><a href="https://mulliganclub.co/ligue-golf-entre-amis/">Le guide pour lancer une ligue de golf entre amis</a><Link href={`/courses/${content.otherSlug}`}>{content.otherLabel}</Link><a href={content.source} target="_blank" rel="noopener noreferrer" className="text-xs text-primary/65">{content.sourceLabel} ↗</a></div>
  </section>
}
