"use client"

import Link from "next/link"
import { Avatar } from "@/components/Avatar"

export interface BestRound {
  score: number
  holes: 9 | 18
  match_id: string
  course_name: string | null
  match_date: string | null
}

export interface TopRival {
  user_id: string
  name: string
  avatar_url: string | null
  wins: number
  losses: number
  ties: number
  total: number
}

export interface RecordsData {
  best_score: BestRound | null
  top_rival: TopRival | null
  longest_streak_weeks: number
}

interface RecordsCardProps {
  records: RecordsData | null
  loading?: boolean
}

export function RecordsCard({ records, loading = false }: RecordsCardProps) {
  const hasAnyRecord =
    !!records &&
    (records.best_score || records.top_rival || records.longest_streak_weeks > 0)

  return (
    <section className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold text-primary">Records</h2>

      {loading ? (
        <div className="flex items-center justify-center py-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
        </div>
      ) : !hasAnyRecord ? (
        <p className="text-center text-xs text-primary/50">
          Play a few rounds and your personal records will appear here.
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-primary/5">
          {records?.best_score && (
            <RecordRow
              icon={<TrophyIcon />}
              iconBg="bg-amber-50"
              iconColor="text-amber-600"
              label="Best round"
              value={
                <span className="flex items-baseline gap-1">
                  <span className="text-lg font-bold tabular-nums text-primary">
                    {records.best_score.score}
                  </span>
                  <span className="text-[10px] font-medium text-primary/40">
                    · {records.best_score.holes} holes
                  </span>
                </span>
              }
              sub={formatBestRoundMeta(records.best_score)}
              href={`/matches/${records.best_score.match_id}`}
            />
          )}

          {records?.top_rival && (
            <RecordRow
              icon={
                <Avatar
                  src={records.top_rival.avatar_url}
                  size={24}
                  fallback={records.top_rival.name}
                  alt=""
                />
              }
              iconBg=""
              iconColor=""
              label={`Top rival: ${records.top_rival.name}`}
              value={
                <span className="inline-flex items-baseline gap-2 text-sm">
                  <span className="font-semibold text-emerald-600 tabular-nums">
                    W {records.top_rival.wins}
                  </span>
                  <span className="text-primary/30">·</span>
                  <span className="font-semibold text-red-500 tabular-nums">
                    L {records.top_rival.losses}
                  </span>
                </span>
              }
              sub={`${records.top_rival.total} round${records.top_rival.total === 1 ? "" : "s"} head-to-head`}
              href={`/players/${records.top_rival.user_id}`}
            />
          )}

          {records && records.longest_streak_weeks > 0 && (
            <RecordRow
              icon={<FlameIcon />}
              iconBg="bg-orange-50"
              iconColor="text-orange-500"
              label="Longest streak"
              value={
                <span className="text-lg font-bold tabular-nums text-primary">
                  {records.longest_streak_weeks}
                  <span className="ml-1 text-[10px] font-medium text-primary/40">
                    week{records.longest_streak_weeks === 1 ? "" : "s"}
                  </span>
                </span>
              }
              sub="consecutive weeks with a match"
            />
          )}
        </div>
      )}
    </section>
  )
}

/* ── Row primitive ────────────────────────────────────── */

function RecordRow({
  icon,
  iconBg,
  iconColor,
  label,
  value,
  sub,
  href,
}: {
  icon: React.ReactNode
  iconBg: string
  iconColor: string
  label: string
  value: React.ReactNode
  sub: string
  href?: string
}) {
  const body = (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full ${iconBg} ${iconColor}`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-primary/70">{label}</p>
          <p className="mt-0.5 truncate text-[11px] text-primary/40">{sub}</p>
        </div>
      </div>
      <div className="shrink-0 text-right">{value}</div>
    </div>
  )

  if (href) {
    return (
      <Link
        href={href}
        className="-mx-2 block rounded-lg px-2 transition-colors hover:bg-cream/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        {body}
      </Link>
    )
  }
  return body
}

/* ── Helpers ──────────────────────────────────────────── */

function formatBestRoundMeta(best: BestRound): string {
  const parts: string[] = []
  if (best.course_name) parts.push(best.course_name)
  if (best.match_date) {
    parts.push(
      new Date(best.match_date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
    )
  }
  return parts.join(" · ") || "Personal best"
}

/* ── Icons ────────────────────────────────────────────── */

function TrophyIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  )
}

function FlameIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  )
}
