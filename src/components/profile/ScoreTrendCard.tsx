"use client"

import { LineChart, Line, ResponsiveContainer, YAxis, Tooltip } from "recharts"

export interface ScoreTrendPoint {
  score: number
  date: string // ISO yyyy-mm-dd
  match_id: string
}

export interface ScoreTrendData {
  points: ScoreTrendPoint[]
  total_rounds: number
  recent_avg: number | null
  previous_avg: number | null
  change: number | null
}

interface ScoreTrendCardProps {
  trend: ScoreTrendData | null
  /** Fallback / self-reported handicap shown when not enough rounds to trend. */
  handicap?: number | null
  loading?: boolean
}

const MIN_ROUNDS_FOR_TREND = 3

export function ScoreTrendCard({
  trend,
  handicap,
  loading = false,
}: ScoreTrendCardProps) {
  return (
    <section className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-primary">Your trajectory</h2>
        {trend && trend.total_rounds > 0 && (
          <span className="text-[11px] text-primary/40">
            {trend.total_rounds} recent round{trend.total_rounds === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
        </div>
      ) : !trend || trend.total_rounds === 0 ? (
        <EmptyState handicap={handicap} />
      ) : trend.total_rounds < MIN_ROUNDS_FOR_TREND ? (
        <EarlyState trend={trend} handicap={handicap} />
      ) : (
        <LoadedState trend={trend} />
      )}
    </section>
  )
}

/* ── States ──────────────────────────────────────────────────── */

function EmptyState({ handicap }: { handicap?: number | null }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-xs text-primary/40 uppercase tracking-wide">Handicap</p>
        <p className="text-3xl font-bold text-primary tabular-nums">
          {handicap != null ? handicap : "\u2013"}
        </p>
      </div>
      <p className="max-w-[180px] text-right text-[11px] text-primary/50">
        Play a few rounds and your trend line will appear here.
      </p>
    </div>
  )
}

function EarlyState({
  trend,
  handicap,
}: {
  trend: ScoreTrendData
  handicap?: number | null
}) {
  const latest = trend.points[trend.points.length - 1]?.score
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-xs text-primary/40 uppercase tracking-wide">Last round</p>
        <p className="text-3xl font-bold text-primary tabular-nums">
          {latest ?? (handicap != null ? handicap : "\u2013")}
        </p>
      </div>
      <p className="max-w-[180px] text-right text-[11px] text-primary/50">
        {MIN_ROUNDS_FOR_TREND - trend.total_rounds} more round
        {MIN_ROUNDS_FOR_TREND - trend.total_rounds === 1 ? "" : "s"} to unlock your trend.
      </p>
    </div>
  )
}

function LoadedState({ trend }: { trend: ScoreTrendData }) {
  const change = trend.change
  const improving = change != null && change < 0 // lower score = improvement
  const unchanged = change != null && Math.abs(change) < 0.5

  const arrow = change == null || unchanged ? "·" : improving ? "\u25BC" : "\u25B2"
  const toneClass =
    change == null || unchanged
      ? "text-primary/40"
      : improving
      ? "text-emerald-600"
      : "text-red-500"

  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-xs text-primary/40 uppercase tracking-wide">Recent avg</p>
          <p className="text-3xl font-bold text-primary tabular-nums">
            {trend.recent_avg}
          </p>
        </div>
        {change != null && (
          <div className={`text-right text-xs ${toneClass}`}>
            <p className="font-semibold">
              {arrow} {Math.abs(change)}
              <span className="ml-1 text-[10px] font-normal">
                vs prior {trend.points.length >= 20 ? "10" : "rounds"}
              </span>
            </p>
            <p className="mt-0.5 text-[10px] text-primary/40">
              {improving
                ? "Trending down — scoring better"
                : unchanged
                ? "Holding steady"
                : "Trending up"}
            </p>
          </div>
        )}
      </div>

      {/* Sparkline */}
      <div className="mt-3 h-16">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={trend.points}
            margin={{ top: 4, right: 4, left: 4, bottom: 4 }}
          >
            <YAxis hide domain={["dataMin - 2", "dataMax + 2"]} />
            <Tooltip
              content={<TrendTooltip />}
              cursor={{ stroke: "rgba(15,61,46,0.2)", strokeWidth: 1 }}
            />
            <Line
              type="monotone"
              dataKey="score"
              stroke="#0F3D2E"
              strokeWidth={2}
              dot={{ r: 2.5, fill: "#0F3D2E" }}
              activeDot={{ r: 4, fill: "#10b981" }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}

/* ── Tooltip ─────────────────────────────────────────────────── */

interface TooltipPayload {
  payload?: ScoreTrendPoint
  value?: number
}

function TrendTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: TooltipPayload[]
}) {
  if (!active || !payload || payload.length === 0) return null
  const p = payload[0]?.payload
  if (!p) return null
  const dateLabel = new Date(p.date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
  return (
    <div className="rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-cream shadow">
      <div className="tabular-nums">{p.score}</div>
      <div className="text-cream/70">{dateLabel}</div>
    </div>
  )
}
