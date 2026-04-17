import Link from "next/link"
import { Avatar } from "@/components/Avatar"
import type { Match, League, MatchPlayer } from "../types"

interface ScheduledMatchesProps {
  matches: Match[]
  league: League
  matchPlayersMap: Map<string | number, MatchPlayer[]>
}

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
              <span className="text-base font-semibold">{p.name}</span>
              {p.score != null && (
                <span
                  className={`text-sm font-semibold ${
                    p.isBestScore
                      ? "text-emerald-600"
                      : "text-orange-500"
                  }`}
                >
                  {p.score}
                </span>
              )}
            </span>
          ))
        ) : (
          <span className="text-base font-semibold">{match.course_name || league.course_name || "Course TBA"}</span>
        )}
      </div>
      <p className="mt-1.5 text-xs text-primary/60">
        {dateLabel}
        {match.match_time ? ` · ${match.match_time.slice(0, 5)}` : ""}
        {(match.course_name || league.course_name) ? ` · ${match.course_name || league.course_name}` : ""}
        {match.status === "completed" && (
          <span className="ml-1.5 inline-block rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary/60">
            Completed
          </span>
        )}
      </p>
    </Link>
  )
}

export function ScheduledMatches({ matches, league, matchPlayersMap }: ScheduledMatchesProps) {
  const today = new Date().toISOString().slice(0, 10)

  const byDateTime = (a: Match, b: Match) => {
    const cmpDate = (a.match_date ?? "").localeCompare(b.match_date ?? "")
    if (cmpDate !== 0) return cmpDate
    return (a.match_time ?? "").localeCompare(b.match_time ?? "")
  }

  const upcoming = matches
    .filter((m) => m.status !== "completed" && (!m.match_date || m.match_date >= today))
    .sort(byDateTime) // soonest first

  const past = matches
    .filter((m) => m.status === "completed" || (m.match_date != null && m.match_date < today))
    .sort((a, b) => -byDateTime(a, b)) // latest first

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
          <div className="space-y-3">
            {upcoming.map((match) => (
              <MatchCard
                key={match.id}
                match={match}
                league={league}
                matchPlayers={matchPlayersMap.get(match.id)}
              />
            ))}
          </div>
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
                ? `${league.scoring_cards_count} best cards counted for ${league.name}`
                : "counted toward leaderboard"}
            </p>
          </div>
          <div className="space-y-3">
            {past.map((match) => (
              <MatchCard
                key={match.id}
                match={match}
                league={league}
                matchPlayers={matchPlayersMap.get(match.id)}
              />
            ))}
          </div>
        </div>
      )}
    </>
  )
}
