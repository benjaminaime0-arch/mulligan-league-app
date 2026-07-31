import { ImageResponse } from "next/og"
import { createClient } from "@supabase/supabase-js"

/**
 * 1080×1080 season-recap card (Phase G) — the shareable image behind
 * /share/season/[gameId]. Same architecture as /api/og/round: nodejs
 * runtime, service-role reads (public-by-link, UUID is the only key),
 * always answers with an image (error card, never JSON).
 *
 * Satori rule (see round route): EVERY multi-child <div> sets display:flex.
 */
export const runtime = "nodejs"

const WIDTH = 1080
const HEIGHT = 1080
const BG = "#E3EDD6"
const PRIMARY = "#0F3D2E"

type PodiumRow = {
  position: number
  player_name: string
  total_score: number
  rounds_counted: number
}

export async function GET(_req: Request, { params }: { params: { gameId: string } }) {
  const { gameId } = params
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return renderErrorCard("Server not configured")
  }
  const supabase = createClient(supabaseUrl, serviceKey)

  const { data: game } = await supabase
    .from("games")
    .select("id, name, course_name, status, start_date, end_date")
    .eq("id", gameId)
    .maybeSingle()
  if (!game) return renderErrorCard("Game not found")

  // Service role passes the leaderboard gate explicitly (see get_leaderboard).
  const { data: board } = await supabase.rpc("get_leaderboard", { p_game_id: gameId })
  const podium = ((board ?? []) as PodiumRow[])
    .filter((r) => Number(r.rounds_counted) > 0)
    .slice(0, 3)

  const g = game as { name: string; course_name: string | null; start_date: string | null; end_date: string | null }
  const seasonLabel = [g.start_date, g.end_date]
    .filter(Boolean)
    .map((d) => new Date(d as string).getFullYear())
    .filter((v, i, a) => a.indexOf(v) === i)
    .join("–")

  const medals = ["🥇", "🥈", "🥉"]

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          background: BG,
          color: PRIMARY,
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 600, opacity: 0.6 }}>
            Récap de saison{seasonLabel ? ` · ${seasonLabel}` : ""}
          </div>
          <div style={{ display: "flex", fontSize: 58, fontWeight: 800, marginTop: 8 }}>
            {g.name}
          </div>
          {g.course_name && (
            <div style={{ display: "flex", fontSize: 30, opacity: 0.7, marginTop: 8 }}>
              {g.course_name}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: 72 }}>
          {podium.map((row, i) => (
            <div
              key={row.position}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: i === 0 ? "#ffffff" : "rgba(255,255,255,0.5)",
                border: i === 0 ? `3px solid ${PRIMARY}` : "3px solid transparent",
                borderRadius: 24,
                padding: "24px 36px",
                marginBottom: 20,
              }}
            >
              <div style={{ display: "flex", alignItems: "center" }}>
                <div style={{ display: "flex", fontSize: 52 }}>{medals[i] ?? ""}</div>
                <div
                  style={{
                    display: "flex",
                    fontSize: i === 0 ? 46 : 38,
                    fontWeight: 700,
                    marginLeft: 24,
                  }}
                >
                  {row.player_name}
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: i === 0 ? 52 : 40,
                  fontWeight: 800,
                  color: i === 0 ? PRIMARY : "rgba(15,61,46,0.6)",
                }}
              >
                {row.total_score}
              </div>
            </div>
          ))}
          {podium.length === 0 && (
            <div style={{ display: "flex", fontSize: 34, opacity: 0.6 }}>
              Saison sans carte comptée
            </div>
          )}
        </div>

        <div style={{ display: "flex", flex: 1 }} />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 24,
            opacity: 0.5,
          }}
        >
          <div style={{ display: "flex" }}>mulliganclub.co</div>
          <div style={{ display: "flex" }}>Mulligan · votre ligue entre amis</div>
        </div>
      </div>
    ),
    { width: WIDTH, height: HEIGHT },
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
          color: PRIMARY,
          alignItems: "center",
          justifyContent: "center",
          fontSize: 40,
          fontFamily: "sans-serif",
        }}
      >
        {message}
      </div>
    ),
    { width: WIDTH, height: HEIGHT },
  )
}
