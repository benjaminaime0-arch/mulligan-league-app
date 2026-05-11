"use client"

/**
 * Badges — a compact honors strip between the Leaderboard and the
 * Activity feed. Surfaces up to 3 "other ways to be notable" that
 * don't show up in rank alone:
 *
 *   Lowest Round    — single best approved score in the game
 *   Most Active     — most cards submitted (min 2 to qualify)
 *   Most Consistent — tightest STDDEV across ≥3 rounds
 *
 * Data shape mirrors `get_league_badges` RPC (one row per earned
 * badge). Rows are rendered in RPC order — the badge_key-driven ORDER
 * BY in SQL keeps the visual sequence stable.
 *
 * When no badges have been earned yet (brand-new game, no approved
 * scores, nobody with ≥2 cards), the card renders an empty-state
 * stub so the section doesn't disappear and reappear as scores land.
 */

import Link from "next/link"
import { Avatar } from "@/components/Avatar"
import type { LeagueFormat } from "@/components/match/types"
import { formatCopy } from "@/lib/leagueFormat"

export interface BadgeRow {
  badge_key: "best_round" | "most_active" | "most_consistent" | string
  user_id: string | null
  player_name: string | null
  avatar_url: string | null
  value: number | null
  unit: string | null
  sub: string | null
}

interface BadgesCardProps {
  badges: BadgeRow[]
  /** Current viewer — highlight their rows with a cream wash. */
  currentUserId?: string | null
  /**
   * Game scoring model. Drives the "Lowest round" vs "Best round"
   * label and the unit suffix ("pts" for stableford). Defaults to
   * stroke play, so profile-level usages that don't care about
   * format can pass it through unchanged.
   */
  leagueFormat?: LeagueFormat
}

export function BadgesCard({ badges, currentUserId, leagueFormat = "stroke_play" }: BadgesCardProps) {
  return (
    <section className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold text-primary">Honors</h2>

      {badges.length === 0 ? (
        <p className="py-2 text-center text-xs text-primary/50">
          Play a few rounds and the honors start earning themselves.
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-primary/5">
          {badges.map((b) => (
            <BadgeRow
              key={b.badge_key}
              badge={b}
              isMe={!!currentUserId && b.user_id === currentUserId}
              leagueFormat={leagueFormat}
            />
          ))}
        </div>
      )}
    </section>
  )
}

/* ── Row primitive ────────────────────────────────────── */

function BadgeRow({
  badge,
  isMe,
  leagueFormat,
}: {
  badge: BadgeRow
  isMe: boolean
  leagueFormat: LeagueFormat
}) {
  const meta = badgeMeta(badge.badge_key, leagueFormat)
  const bg = isMe ? "bg-cream/50" : ""

  const body = (
    <div className={`-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 ${bg}`}>
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${meta.iconBg} ${meta.iconColor}`}
        aria-hidden
      >
        {meta.icon}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-primary/70">
          {meta.label}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-primary/50">
          {badge.avatar_url !== undefined && (
            <Avatar
              src={badge.avatar_url}
              size={14}
              fallback={badge.player_name || "P"}
              alt=""
            />
          )}
          <span className="truncate">
            {badge.player_name || "Player"}
            {badge.sub ? ` · ${badge.sub}` : ""}
          </span>
        </p>
      </div>

      <div className="shrink-0 text-right">
        <span className="text-lg font-bold tabular-nums text-primary">
          {formatValue(badge, leagueFormat)}
        </span>
        {meta.valueSuffix && (
          <span className="ml-1 text-[10px] font-medium text-primary/40">
            {meta.valueSuffix(badge)}
          </span>
        )}
      </div>
    </div>
  )

  if (badge.user_id) {
    return (
      <Link
        href={`/players/${badge.user_id}`}
        className="rounded-lg transition-colors hover:bg-cream/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        {body}
      </Link>
    )
  }
  return body
}

/* ── Helpers ──────────────────────────────────────────── */

function formatValue(b: BadgeRow, format: LeagueFormat): string {
  if (b.value == null) return "—"
  // Most Consistent → ±3.2 (prefix the sign to read as "spread").
  if (b.badge_key === "most_consistent") return `±${Number(b.value).toFixed(1)}`
  // Best round carries the format's unit suffix (" pts" for
  // stableford, nothing for stroke play). Most active is always
  // just a round count — no unit on the number.
  const n = Math.round(Number(b.value))
  if (b.badge_key === "best_round") return `${n}${formatCopy(format).unit}`
  return String(n)
}

/* ── Badge metadata (icon, label, tints) ──────────────── */

type BadgeMeta = {
  label: string
  icon: React.ReactNode
  iconBg: string
  iconColor: string
  /** Small text after the main number, e.g. "score" / "rounds". */
  valueSuffix?: (b: BadgeRow) => string
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
        valueSuffix: (b) => (Number(b.value) === 1 ? "round" : "rounds"),
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
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  )
}

function BoltIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M13 2L4.5 13.5a1 1 0 0 0 .8 1.6H11l-1.5 7a.5.5 0 0 0 .9.35L19.5 10.5a1 1 0 0 0-.8-1.6H13l1.5-7A.5.5 0 0 0 13 2Z" />
    </svg>
  )
}

function EqualizerIcon() {
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
      <line x1="6" y1="4" x2="6" y2="20" />
      <line x1="12" y1="8" x2="12" y2="20" />
      <line x1="18" y1="12" x2="18" y2="20" />
      <line x1="3" y1="20" x2="21" y2="20" />
    </svg>
  )
}

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
