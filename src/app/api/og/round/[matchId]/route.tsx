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
 * Note: satori (the engine behind next/og) requires every <div>
 * with more than one child to explicitly set `display: flex` (or
 * `display: none`). Defensive rule in this file: every <div> sets
 * display: flex. Use <span> for inline text.
 */

export const runtime = "nodejs"

const WIDTH = 1080
const HEIGHT = 1080
const BG = "#E3EDD6" // cream (keep in sync with tailwind.config.ts)
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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error("[og/round] missing env vars", {
      hasUrl: !!supabaseUrl,
      hasKey: !!serviceKey,
    })
    return renderErrorCard("Server not configured")
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  const [matchRes, playersRes, scoresRes] = await Promise.all([
    supabase
      .from("matches")
      .select("id, course_name, match_date, league_id")
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

  if (matchRes.error) {
    console.error("[og/round] match fetch error", matchRes.error)
    return renderErrorCard(`Error: ${matchRes.error.message.slice(0, 40)}`)
  }
  if (!matchRes.data) {
    console.error("[og/round] match not found", { matchId })
    return renderErrorCard(`Match ${matchId.slice(0, 8)} not found`)
  }

  const match = matchRes.data as {
    id: string
    course_name: string | null
    match_date: string | null
    league_id: string | null
  }

  let league: { name: string; course_name: string | null } | null = null
  if (match.league_id) {
    const { data: leagueData } = await supabase
      .from("leagues")
      .select("name, course_name")
      .eq("id", match.league_id)
      .maybeSingle()
    if (leagueData) {
      league = leagueData as { name: string; course_name: string | null }
    }
  }

  const players = (playersRes.data || []) as PlayerRow[]
  const scores = (scoresRes.data || []) as ScoreRow[]

  const scoreMap = new Map<string, number>()
  for (const s of scores) {
    if (s.status === "approved" || s.status === null) scoreMap.set(s.user_id, s.score)
  }

  const approvedScores = scores.filter(
    (s) => s.status === "approved" || s.status === null,
  )
  let winnerScore: number | null = null
  if (approvedScores.length > 0) {
    winnerScore = Math.min(...approvedScores.map((s) => s.score))
  }

  const rendered: RenderPlayer[] = players.map((p) => {
    const profile = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles
    const name = profile?.username || profile?.first_name || "Player"
    const score = scoreMap.get(p.user_id) ?? null
    return {
      name,
      initial: name.charAt(0).toUpperCase(),
      score,
      isWinner: score != null && score === winnerScore,
    }
  })
  rendered.sort((a, b) => {
    if (a.score == null && b.score == null) return 0
    if (a.score == null) return 1
    if (b.score == null) return -1
    return a.score - b.score
  })

  const courseName = match.course_name || league?.course_name || "Course"
  const leagueName = league?.name || "Match"
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
          padding: "64px",
          color: PRIMARY,
        }}
      >
        {/* Top brand strip */}
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 56,
              height: 56,
              borderRadius: 14,
              background: PRIMARY,
              color: BG,
              fontSize: 30,
              fontWeight: 800,
              marginRight: 16,
            }}
          >
            ML
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            Mulligan League
          </div>
        </div>

        {/* Match heading */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 80,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 28,
              color: PRIMARY,
              opacity: 0.6,
              fontWeight: 600,
              letterSpacing: 1.5,
              textTransform: "uppercase",
            }}
          >
            {leagueName}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 96,
              fontWeight: 800,
              lineHeight: 1.05,
              marginTop: 8,
            }}
          >
            {courseName}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 32,
              opacity: 0.7,
              fontWeight: 500,
              marginTop: 12,
            }}
          >
            {dateStr}
          </div>
        </div>

        {/* Players */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 64,
          }}
        >
          {rendered.slice(0, 4).map((p, idx) => (
            <PlayerRowView key={idx} player={p} isFirst={idx === 0} />
          ))}
        </div>

        {/* Spacer */}
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
          <div style={{ display: "flex" }}>app.mulliganleague.com</div>
          <div style={{ display: "flex" }}>
            {rendered.length} player{rendered.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>
    ),
    { width: WIDTH, height: HEIGHT },
  )
}

function PlayerRowView({
  player,
  isFirst,
}: {
  player: RenderPlayer
  isFirst: boolean
}) {
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
        border: highlight ? `3px solid ${PRIMARY}` : "3px solid rgba(0,0,0,0)",
        marginTop: isFirst ? 0 : 16,
      }}
    >
      {/* Left: avatar + name + chip */}
      <div style={{ display: "flex", alignItems: "center" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 64,
            height: 64,
            borderRadius: 32,
            background: PRIMARY,
            color: BG,
            fontSize: 34,
            fontWeight: 700,
            marginRight: 20,
          }}
        >
          {player.initial}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 38,
              fontWeight: 700,
              color: PRIMARY,
            }}
          >
            {player.name}
          </div>
          {highlight && (
            <div
              style={{
                display: "flex",
                fontSize: 16,
                fontWeight: 700,
                padding: "4px 12px",
                borderRadius: 999,
                background: "#fef3c7",
                color: "#b45309",
                letterSpacing: 1,
                textTransform: "uppercase",
                marginLeft: 12,
              }}
            >
              Winner
            </div>
          )}
        </div>
      </div>

      {/* Right: score */}
      <div
        style={{
          display: "flex",
          fontSize: 68,
          fontWeight: 800,
          color: highlight ? PRIMARY : "rgba(15,61,46,0.55)",
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
          display: "flex",
          width: "100%",
          height: "100%",
          background: BG,
          alignItems: "center",
          justifyContent: "center",
          fontSize: 52,
          color: PRIMARY,
          fontWeight: 700,
          padding: "48px",
          textAlign: "center",
        }}
      >
        {message}
      </div>
    ),
    { width: WIDTH, height: HEIGHT },
  )
}
