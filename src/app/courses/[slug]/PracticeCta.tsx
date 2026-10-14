"use client"
import Link from "next/link"
import { useAuthContext } from "@/components/AuthProvider"
import { useT } from "@/lib/i18n"
export function PracticeCta({ courseId }: { courseId: string; courseName: string; slug: string }) {
  const { user } = useAuthContext()
  const t = useT()
  const destination = `/rounds?course=${courseId}`
  return <section className="mt-8 rounded-xl border border-primary/15 bg-cream p-4">
    <h2 className="font-semibold">{t("personal.new")}</h2>
    <p className="mt-2 text-sm text-primary/70">{t("personal.courseEntry")}</p>
    <Link className="mt-3 inline-flex min-h-[44px] items-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-cream" href={user ? destination : `/?redirect=${encodeURIComponent(destination)}`}>{t("personal.new")}</Link>
  </section>
}
