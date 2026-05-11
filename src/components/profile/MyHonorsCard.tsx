"use client"

/**
 * Trophy shelf — cross-tournament honors the viewer currently holds.
 *
 * Each row summarises one badge in one tournament. Rows are grouped by
 * tournament so the viewer sees their standing-per-tournament at a glance
 * rather than a flat mix of "3 lowest rounds across 3 tournaments".
 *
 * Badge metadata (icon, label, formatting) is duplicated from the
 * per-tournament `BadgesCard` for now — extract to `src/lib/badges.ts`
 * the moment a third surface needs it. Keeping it inline prevents
 * a premature abstraction when the single source of truth for the
 * badge list (the `get_league_badges` RPC) already lives in SQL.
 */

import Link from "next/link"
import type { LeagueFormat } from "@/components/match/types"
import { formatCopy } from "@/lib/leagueFormat"

export interface UserHonorRow {
  league_id: string | null
  league_name: string | null
  /**
   * Format of the tournament this honor belongs to. Rides along per-row
   * (unlike the per-tournament BadgesCard which gets it once from its
   * parent) because the trophy shelf can mix tournaments of different
   * formats — each row needs its own "strokes vs points" context.
   */
  league_format?: LeagueFormat | string | null
  badge_key: "best_round" | "most_active" | "most_consistent" | string
  value: number | null
  unit: string | null
  sub: string | null
}

interface MyHonorsCardProps {
  honors: UserHonorRow[]
  loading?: boolean
}

export function MyHonorsCard({ honors, loading = false }: MyHonorsCardProps) {
  // Group by tournament — one block per tournament, rows = badges held in it.
  const byLeague = groupByLeague(honors)

  return (
    <section className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold text-primary">Your honors</h2>

      {loading ? (
        <div className="flex items-center justify-center py-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
        </div>
      ) : byLeague.length === 0 ? (
        <p className="py-2 text-center text-xs text-primary/50">
          Keep playing — your first honor will land soon.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {byLeague.map((group) => (
            <LeagueGroup key={group.leagueId ?? group.leagueName} group={group} />
          ))}
        </div>
      )}
    </section>
  )
}

/* ── Tournament group ─────────────────────────────────────── */

type LeagueGroupShape = {
  leagueId: string | null
  leagueName: string
  rows: UserHonorRow[]
}

function LeagueGroup({ group }: { group: LeagueGroupShape }) {
  const header = (
    <h3 className="mb-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-primary/50">
      <span className="truncate">{group.leagueName}</span>
      {group.leagueId && (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-primary/30"
          aria-hidden="true"
        >
          <polyline points="9 6 15 12 9 18" />
        </svg>
      )}
    </h3>
  )

  const body = (
    <div className="flex flex-col divide-y divide-primary/5">
      {group.rows.map((r) => (
        <HonorRow key={r.badge_key} row={r} />
      ))}
    </div>
  )

  if (group.leagueId) {
    return (
      <div>
        <Link
          href={`/leagues/${group.leagueId}`}
          className="block rounded-md transition-colors hover:bg-cream/30"
        >
          {header}
        </Link>
        {body}
      </div>
    )
  }
  return (
    <div>
      {header}
      {body}
    </div>
  )
}

/* ── Row primitive ────────────────────────────────────── */

function HonorRow({ row }: { row: UserHonorRow }) {
  const format: LeagueFormat =
    row.league_format === "stableford" ? "stableford" : "stroke_play"
  const meta = badgeMeta(row.badge_key, format)
  return (
    <div className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5">
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${meta.iconBg} ${meta.iconColor}`}
        aria-hidden
      >
        {meta.icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-primary/70">
          {meta.label}
        </p>
        {row.sub && (
          <p className="mt-0.5 truncate text-[11px] text-primary/40">
            {row.sub}
          </p>
        )}
      </div>
      <div className="shrink-0 text-right">
        <span className="text-base font-bold tabular-nums text-primary">
          {formatValue(row, format)}
        </span>
        {meta.valueSuffix && (
          <span className="ml-1 text-[10px] font-medium text-primary/40">
            {meta.valueSuffix(row)}
          </span>
        )}
      </div>
    </div>
  )
}

/* ── Helpers ──────────────────────────────────────────── */

function groupByLeague(rows: UserHonorRow[]): LeagueGroupShape[] {
  const map = new Map<string, LeagueGroupShape>()
  for (const r of rows) {
    const key = String(r.league_id ?? r.league_name ?? "_")
    const existing = map.get(key)
    if (existing) {
      existing.rows.push(r)
    } else {
      map.set(key, {
        leagueId: r.league_id ? String(r.league_id) : null,
        leagueName: r.league_name || "League",
        rows: [r],
      })
    }
  }
  return Array.from(map.values())
}

function formatValue(r: UserHonorRow, format: LeagueFormat): string {
  if (r.value == null) return "—"
  if (r.badge_key === "most_consistent") return `±${Number(r.value).toFixed(1)}`
  const n = Math.round(Number(r.value))
  if (r.badge_key === "best_round") return `${n}${formatCopy(format).unit}`
  return String(n)
}

/* ── Badge metadata ───────────────────────────────────── */

type BadgeMeta = {
  label: string
  icon: React.ReactNode
  iconBg: string
  iconColor: string
  valueSuffix?: (r: UserHonorRow) => string
}

function badgeMeta(key: string, format: LeagueFormat): BadgeMeta {
  switch (key) {
    case "best_round":
      return {
        label: formatCopy(format).bestRoundLabel,
        icon: <TargetIcon />,
        iconBg: "bg-amber-50",
        iconColor: "text-amber-600",
      }
    case "most_active":
      return {
        label: "Most active",
        icon: <BoltIcon />,
        iconBg: "bg-orange-50",
        iconColor: "text-orange-500",
        valueSuffix: (r) => (Number(r.value) === 1 ? "round" : "rounds"),
      }
    case "most_consistent":
      return {
        label: "Most consistent",
        icon: <EqualizerIcon />,
        iconBg: "bg-primary/5",
        iconColor: "text-primary",
      }
    default:
      return {
        label: key,
        icon: <TrophyIcon />,
        iconBg: "bg-primary/5",
        iconColor: "text-primary/60",
      }
  }
}

/* ── Icons ────────────────────────────────────────────── */

function TargetIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  )
}
function BoltIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13 2L4.5 13.5a1 1 0 0 0 .8 1.6H11l-1.5 7a.5.5 0 0 0 .9.35L19.5 10.5a1 1 0 0 0-.8-1.6H13l1.5-7A.5.5 0 0 0 13 2Z" />
    </svg>
  )
}
function EqualizerIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="6" y1="4" x2="6" y2="20" />
      <line x1="12" y1="8" x2="12" y2="20" />
      <line x1="18" y1="12" x2="18" y2="20" />
      <line x1="3" y1="20" x2="21" y2="20" />
    </svg>
  )
}
function TrophyIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  )
}
