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
  const dateLabel = match.match_date
    ? new Date(match.match_date).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "Date TBA"

  return (
    <Link
      href={`/matches/${match.id}`}
      className="block rounded-lg bg-cream px-4 py-4 text-center text-primary hover:bg-primary/5"
    >
      <div className="flex flex-wrap items-center justify-center gap-x-2.5">
        {matchPlayers && matchPlayers.length > 0 ? (
          matchPlayers.map((p, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              {i > 0 && <span className="text-xs font-normal text-primary/40">&amp;</span>}
              <Avatar src={p.avatar_url} size={32} fallback={p.name} />
              <span className="flex flex-col items-center">
                <span className="text-base font-semibold">{p.name}</span>
                {p.score != null && (
                  <span
                    className={`text-xs font-semibold ${
                      p.isBestScore
                        ? "text-emerald-600"
                        : "text-orange-500"
                    }`}
                  >
                    {p.score}
                  </span>
                )}
              </span>
            </span>
          ))
        ) : (
          <span className="text-base font-semibold">
            {match.course_name || league.course_name || "Course TBA"}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-xs text-primary/60">
        {dateLabel}
        {match.match_time ? ` · ${match.match_time.slice(0, 5)}` : ""}
        {(match.course_name || league.course_name)
          ? ` · ${match.course_name || league.course_name}`
          : ""}
        {match.status === "completed" && (
          <span className="ml-1.5 inline-block rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary/60">
            Completed
          </span>
        )}
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
          <p className="text-center text-sm text-primary/70">
            No matches scheduled yet. Create one to get the week rolling.
          </p>
        ) : (
          <MatchCarousel items={upcoming} league={league} matchPlayersMap={matchPlayersMap} />
        )}
      </div>

      {/* Past Matches */}
      {past.length > 0 && (
        <div className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-primary">Past Matches</h2>
            <p className="text-[10px] text-primary/40">
              <span className="font-semibold text-emerald-600">Green</span> ={" "}
              {league.scoring_cards_count
                ? `${league.scoring_cards_count} best cards counted`
                : "counted toward leaderboard"}
            </p>
          </div>
          <MatchCarousel items={past} league={league} matchPlayersMap={matchPlayersMap} />
        </div>
      )}
    </>
  )
}
