"use client"

import { useState } from "react"

import { useI18n } from "@/lib/i18n"

export interface CoursePlay {
  course_name: string
  times_played: number
  best_score: number | null
  last_played_date: string | null
}

interface CoursesCardProps {
  courses: CoursePlay[] | null
  loading?: boolean
}

const INITIAL_VISIBLE = 3

export function CoursesCard({ courses, loading = false }: CoursesCardProps) {
  const [expanded, setExpanded] = useState(false)
  const { t, locale } = useI18n()

  const totalCourses = courses?.length ?? 0
  const totalRounds = (courses ?? []).reduce((sum, c) => sum + Number(c.times_played), 0)

  const visible = expanded ? courses ?? [] : (courses ?? []).slice(0, INITIAL_VISIBLE)
  const hasMore = (courses?.length ?? 0) > INITIAL_VISIBLE

  return (
    <section className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-primary">{t("profile.courses.title")}</h2>
        {totalCourses > 0 && (
          <span className="text-[11px] text-primary/50">
            {totalCourses === 1
              ? t("profile.courses.count.one")
              : t("profile.courses.count", { n: totalCourses })}{" "}
            ·{" "}
            {totalRounds === 1
              ? t("profile.rounds.count.one")
              : t("profile.rounds.count", { n: totalRounds })}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
        </div>
      ) : totalCourses === 0 ? (
        <div className="flex flex-col items-center justify-center py-4 text-center">
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/5">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-primary/40"
              aria-hidden="true"
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          </div>
          <p className="text-sm font-medium text-primary/70">{t("profile.courses.empty")}</p>
          <p className="mt-0.5 text-xs text-primary/40">
            {t("profile.courses.empty.sub")}
          </p>
        </div>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-primary/5">
            {visible.map((course) => (
              <li
                key={course.course_name}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                    <PinIcon />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-primary">
                      {course.course_name}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-primary/50">
                      {Number(course.times_played) === 1
                        ? t("profile.rounds.count.one")
                        : t("profile.rounds.count", { n: course.times_played })}
                      {course.last_played_date
                        ? ` · ${t("profile.courses.last", {
                            date: formatDate(course.last_played_date, locale),
                          })}`
                        : ""}
                    </p>
                  </div>
                </div>
                {course.best_score != null && (
                  <div className="shrink-0 text-right">
                    <p className="text-[10px] uppercase tracking-wide text-primary/40">
                      {t("games.standings.col.best")}
                    </p>
                    <p className="text-sm font-bold tabular-nums text-primary">
                      {course.best_score}
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>

          {hasMore && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 w-full rounded-lg border border-primary/15 bg-white py-2 text-xs font-medium text-primary/70 hover:bg-primary/5"
            >
              {expanded
                ? t("common.showless")
                : t("common.showmore", { n: totalCourses - INITIAL_VISIBLE })}
            </button>
          )}
        </>
      )}
    </section>
  )
}

// Module scope: the active locale is handed in by the component.
function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
  })
}

function PinIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}
