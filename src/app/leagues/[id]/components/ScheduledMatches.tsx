"use client"

import { useState } from "react"
import Link from "next/link"
import { Avatar } from "@/components/Avatar"
import type { Match, League, MatchPlayer } from "../types"

interface ScheduledMatchesProps {
  matches: Match[]
  league: League
  matchPlayersMap: Map<string | number, MatchPlayer[]>
}

/* ── Shared chevron SVG ────────────────────────────────── */
function Chevron({ direction }: { direction: "left" | "right" }) {
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
    >
      {direction === "left" ? (
        <polyline points="15 18 9 12 15 6" />
      ) : (
        <polyline points="9 6 15 12 9 18" />
      )}
    </svg>
  )
}

/* ── Single match card ─────────────────────────────────── */
function MatchCard({
  match,
  league,
  matchPlayers,
}: {
  match: Match
  league: League
  matchPlayers?: MatchPlayer[]
}) {
  const isCompleted = match.status === "completed"
  const dateLabel = match.match_date
    ? new Date(match.match_date).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "Date TBA"
  const courseLabel = match.course_name || league.course_name

  // Sort completed matches by score (lowest first, nulls last)
  const sorted = matchPlayers
    ? isCompleted
      ? [...matchPlayers].sort((a, b) => {
          if (a.score == null && b.score == null) return 0
          if (a.score == null) return 1
          if (b.score == null) return -1
          return a.score - b.score
        })
      : matchPlayers
    : []

  return (
    <Link
      href={`/matches/${match.id}`}
      className="block rounded-lg bg-white px-4 py-4 text-center text-primary transition-colors hover:bg-cream/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
    >
      {/* Completed badge sits above the avatar stack so it doesn't collide
          with the metadata line below. */}
      {isCompleted && (
        <div className="mb-2 flex justify-center">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Completed
          </span>
        </div>
      )}

      <div className="flex items-start justify-center gap-3">
        {sorted.length > 0 ? (
          sorted.map((p, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className="relative">
                <Avatar src={p.avatar_url} size={32} fallback={p.name} />
                {p.isBestScore && (
                  <span
                    className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 text-white"
                    aria-label="Best score"
                    title="Counts toward leaderboard"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="8"
                      height="8"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                )}
              </div>
              <span className="max-w-[64px] truncate text-[11px] font-semibold text-primary/80">
                {p.name}
              </span>
              {p.score != null && (
                <span
                  className={`text-sm font-bold tabular-nums ${
                    p.isBestScore ? "text-emerald-600" : "text-primary/70"
                  }`}
                >
                  {p.score}
                </span>
              )}
            </div>
          ))
        ) : (
          <span className="text-base font-semibold">
            {courseLabel || "Course TBA"}
          </span>
        )}
      </div>

      <p className="mt-2 text-xs text-primary/60">
        {dateLabel}
        {match.match_time ? ` · ${match.match_time.slice(0, 5)}` : ""}
        {courseLabel ? ` · ${courseLabel}` : ""}
      </p>
    </Link>
  )
}

/* ── Carousel wrapper ──────────────────────────────────── */
function MatchCarousel({
  items,
  league,
  matchPlayersMap,
}: {
  items: Match[]
  league: League
  matchPlayersMap: Map<string | number, MatchPlayer[]>
}) {
  const [index, setIndex] = useState(0)

  if (items.length === 0) return null

  const current = items[index]
  const hasPrev = index > 0
  const hasNext = index < items.length - 1

  return (
    <div className="flex items-center gap-2">
      {/* Left arrow */}
      <button
        type="button"
        onClick={() => setIndex((i) => i - 1)}
        disabled={!hasPrev}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-white text-primary transition-opacity ${
          hasPrev ? "hover:bg-primary/5" : "opacity-0 pointer-events-none"
        }`}
      >
        <Chevron direction="left" />
      </button>

      {/* Card */}
      <div className="min-w-0 flex-1">
        <MatchCard
          match={current}
          league={league}
          matchPlayers={matchPlayersMap.get(current.id)}
        />
      </div>

      {/* Right arrow */}
      <button
        type="button"
        onClick={() => setIndex((i) => i + 1)}
        disabled={!hasNext}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-white text-primary transition-opacity ${
          hasNext ? "hover:bg-primary/5" : "opacity-0 pointer-events-none"
        }`}
      >
        <Chevron direction="right" />
      </button>
    </div>
  )
}

/* ── Main export ───────────────────────────────────────── */
export function ScheduledMatches({ matches, league, matchPlayersMap }: ScheduledMatchesProps) {
  const today = new Date().toISOString().slice(0, 10)

  const byDateTime = (a: Match, b: Match) => {
    const cmpDate = (a.match_date ?? "").localeCompare(b.match_date ?? "")
    if (cmpDate !== 0) return cmpDate
    return (a.match_time ?? "").localeCompare(b.match_time ?? "")
  }

  const upcoming = matches
    .filter((m) => m.status !== "completed" && (!m.match_date || m.match_date >= today))
    .sort(byDateTime)

  const past = matches
    .filter((m) => m.status === "completed" || (m.match_date != null && m.match_date < today))
    .sort((a, b) => -byDateTime(a, b))

  return (
    <>
      {/* Scheduled / Upcoming */}
      <div className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-primary">Scheduled Matches</h2>
          <Link
            href={`/matches/create?league=${league.id}`}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-cream hover:bg-primary/90"
          >
            Create Match
          </Link>
        </div>
        {upcoming.length === 0 ? (
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
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <p className="text-sm font-medium text-primary/70">
              No matches scheduled yet
            </p>
            <p className="mt-0.5 text-xs text-primary/40">
              Create one to get the week rolling.
            </p>
          </div>
        ) : (
          <MatchCarousel items={upcoming} league={league} matchPlayersMap={matchPlayersMap} />
        )}
      </div>

      {/* Past Matches */}
      <div className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-primary">Past Matches</h2>
        </div>
        {past.length === 0 ? (
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
                <path d="M12 8v4l3 3" />
                <circle cx="12" cy="12" r="10" />
              </svg>
            </div>
            <p className="text-sm font-medium text-primary/70">
              No completed matches yet
            </p>
            <p className="mt-0.5 text-xs text-primary/40">
              Results will appear here once scores are approved.
            </p>
          </div>
        ) : (
          <>
            {league.scoring_cards_count && (
              <div className="mb-3 flex items-center justify-center gap-1.5 text-[11px] text-primary/50">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span>Best {league.scoring_cards_count} cards count toward leaderboard</span>
              </div>
            )}
            <MatchCarousel items={past} league={league} matchPlayersMap={matchPlayersMap} />
          </>
        )}
      </div>
    </>
  )
}
