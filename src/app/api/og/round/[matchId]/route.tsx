import { ImageResponse } from "next/og"
import { createClient } from "@supabase/supabase-js"

/**
 * Public endpoint: GET /api/og/round/[matchId]
 * Returns a 1080x1080 PNG summarising a completed match — a
 * shareable card for Instagram / WhatsApp / X / text messages.
 *
 * The URL is also used as the Open Graph image for
 * /share/round/[matchId], so link previews in chat apps render
 * the card automatically.
 *
 * Data fetch uses the service role key (server-only) to bypass RLS,
 * but matches/match_players/scores are already read-open for any
 * authenticated user (this is an open platform) so no new exposure.
 */

export const runtime = "nodejs"

const WIDTH = 1080
const HEIGHT = 1080
const BG = "#C6D9B7" // cream (Tailwind token)
const PRIMARY = "#0F3D2E"

type PlayerRow = {
  user_id: string
  profiles?: {
    username?: string | null
    first_name?: string | null
  } | null
}

type ScoreRow = {
  user_id: string
  score: number
  status: string | null
}

type RenderPlayer = {
  name: string
  initial: string
  score: number | null
  isWinner: boolean
}

export async function GET(
  _req: Request,
  { params }: { params: { matchId: string } },
) {
  const matchId = params.matchId

  // Fallback card if the match can't be loaded
  const errorCard = renderErrorCard("Match not found")

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return errorCard

  const supabase = createClient(supabaseUrl, serviceKey)

  const [matchRes, playersRes, scoresRes] = await Promise.all([
    supabase
      .from("matches")
      .select("id, course_name, match_date, match_type, leagues(name, course_name)")
      .eq("id", matchId)
      .maybeSingle(),
    supabase
      .from("match_players")
      .select("user_id, profiles(username, first_name)")
      .eq("match_id", matchId),
    supabase
      .from("scores")
      .select("user_id, score, status")
      .eq("match_id", matchId),
  ])

  if (matchRes.error || !matchRes.data) return errorCard

  const match = matchRes.data as {
    id: string
    course_name: string | null
    match_date: string | null
    match_type: string | null
    leagues?: { name: string; course_name: string | null } | { name: string; course_name: string | null }[] | null
  }
  const league = Array.isArray(match.leagues) ? match.leagues[0] : match.leagues
  const players = (playersRes.data || []) as PlayerRow[]
  const scores = (scoresRes.data || []) as ScoreRow[]

  const scoreMap = new Map<string, number>()
  for (const s of scores) {
    if (s.status === "approved" || s.status === null) scoreMap.set(s.user_id, s.score)
  }

  // Compute winner = lowest approved score
  const approvedScores = scores.filter((s) => s.status === "approved" || s.status === null)
  let winnerScore: number | null = null
  if (approvedScores.length > 0) {
    winnerScore = Math.min(...approvedScores.map((s) => s.score))
  }

  const rendered: RenderPlayer[] = players.map((p) => {
    const name = p.profiles?.username || p.profiles?.first_name || "Player"
    const score = scoreMap.get(p.user_id) ?? null
    return {
      name,
      initial: name.charAt(0).toUpperCase(),
      score,
      isWinner: score != null && score === winnerScore,
    }
  })
  // Sort: winners first, then by score asc, no-score last
  rendered.sort((a, b) => {
    if (a.score == null && b.score == null) return 0
    if (a.score == null) return 1
    if (b.score == null) return -1
    return a.score - b.score
  })

  const courseName = match.course_name || league?.course_name || "Course"
  const leagueName = league?.name || (match.match_type === "casual" ? "Casual Match" : "Match")
  const dateStr = match.match_date
    ? new Date(match.match_date).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : ""

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: BG,
          display: "flex",
          flexDirection: "column",
          padding: 64,
          fontFamily: "system-ui, -apple-system, sans-serif",
          color: PRIMARY,
        }}
      >
        {/* Top: brand wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: PRIMARY,
              color: BG,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 28,
              fontWeight: 800,
            }}
          >
            ML
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 0.5,
              textTransform: "uppercase",
            }}
          >
            Mulligan League
          </div>
        </div>

        {/* Match heading */}
        <div style={{ marginTop: 80, display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              fontSize: 26,
              color: PRIMARY,
              opacity: 0.6,
              fontWeight: 600,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            {leagueName}
          </div>
          <div style={{ fontSize: 92, fontWeight: 800, lineHeight: 1, letterSpacing: -2 }}>
            {courseName}
          </div>
          <div style={{ fontSize: 30, opacity: 0.7, fontWeight: 500, marginTop: 4 }}>
            {dateStr}
          </div>
        </div>

        {/* Players + scores */}
        <div
          style={{
            marginTop: 70,
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          {rendered.slice(0, 4).map((p, idx) => (
            <PlayerRowView key={idx} player={p} />
          ))}
        </div>

        {/* Spacer to push footer down */}
        <div style={{ display: "flex", flex: 1 }} />

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 22,
            opacity: 0.5,
          }}
        >
          <span>app.mulliganleague.com</span>
          <span>{rendered.length} players</span>
        </div>
      </div>
    ),
    { width: WIDTH, height: HEIGHT },
  )
}

function PlayerRowView({ player }: { player: RenderPlayer }) {
  const highlight = player.isWinner
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "20px 28px",
        borderRadius: 24,
        background: highlight ? "#ffffff" : "rgba(255,255,255,0.55)",
        border: highlight ? `3px solid ${PRIMARY}` : "3px solid transparent",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        {/* Avatar initial circle */}
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            background: PRIMARY,
            color: BG,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 34,
            fontWeight: 700,
          }}
        >
          {player.initial}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 38, fontWeight: 700, color: PRIMARY }}>
            {player.name}
          </span>
          {highlight && (
            <span
              style={{
                fontSize: 18,
                fontWeight: 700,
                padding: "4px 12px",
                borderRadius: 999,
                background: "#fef3c7",
                color: "#b45309",
                letterSpacing: 1,
                textTransform: "uppercase",
              }}
            >
              Winner
            </span>
          )}
        </div>
      </div>
      <div
        style={{
          fontSize: 68,
          fontWeight: 800,
          color: highlight ? PRIMARY : "rgba(15,61,46,0.55)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {player.score ?? "\u2013"}
      </div>
    </div>
  )
}

function renderErrorCard(message: string) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: BG,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          fontSize: 52,
          color: PRIMARY,
          fontWeight: 700,
        }}
      >
        {message}
      </div>
    ),
    { width: WIDTH, height: HEIGHT },
  )
}
