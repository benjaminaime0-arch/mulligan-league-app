"use client"

import { useEffect, useState } from "react"
import {
  LineChart,
  Line,
  ResponsiveContainer,
  YAxis,
  XAxis,
  CartesianGrid,
  Tooltip,
} from "recharts"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"

export interface ScoreTrendPoint {
  score: number
  date: string // ISO yyyy-mm-dd
  match_id: string
}

type Range = "week" | "month" | "year" | "recent"

export interface ScoreTrendData {
  range?: Range
  points: ScoreTrendPoint[]
  total_rounds: number
  recent_avg: number | null
  previous_avg: number | null
  change: number | null
}

interface ScoreTrendCardProps {
  /** Shown as a fallback value when there aren't enough rounds to trend. */
  handicap?: number | null
  /**
   * Optional override — when viewing another player's profile we pass
   * their id here. Falls back to the signed-in user when omitted so the
   * component keeps working on `/profile` without extra wiring.
   */
  userId?: string
}

const MIN_ROUNDS_FOR_TREND = 3

const RANGE_OPTIONS: Array<{ value: Range; label: string }> = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
  { value: "recent", label: "All" },
]

export function ScoreTrendCard({ handicap, userId }: ScoreTrendCardProps) {
  const { user, loading: authLoading } = useAuth()
  const [range, setRange] = useState<Range>("month")
  const [trend, setTrend] = useState<ScoreTrendData | null>(null)
  const [fetching, setFetching] = useState(false)

  // Target user: explicit prop wins, otherwise fall back to the signed-in
  // user so the existing `/profile` usage keeps working unchanged.
  const targetId = userId ?? user?.id
  // Still wait on authLoading — without a session the RLS-protected RPC
  // would reject the call anyway.
  const canFetch = !authLoading && !!targetId

  useEffect(() => {
    if (!canFetch) return
    let cancelled = false
    const load = async () => {
      setFetching(true)
      const { data, error } = await supabase.rpc("get_profile_score_trend", {
        p_user_id: targetId,
        p_range: range,
      })
      if (cancelled) return
      if (error) {
        // Most common cause of empty data here is the missing DB migration:
        // patch_profile_score_trend_range.sql (adds the p_range parameter).
        // Surface it loudly in console so we can tell from DevTools.
        console.error("[ScoreTrendCard] get_profile_score_trend failed:", error.message)
      }
      if (!error && data) setTrend(data as ScoreTrendData)
      setFetching(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [canFetch, targetId, range])

  // Only show the full spinner on FIRST load (trend still null). On range
  // changes, keep the previous chart visible and just fade it while the new
  // data loads — feels snappier than a flashing spinner.
  const showInitialSpinner = trend === null && fetching

  return (
    <section className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-primary">
          Your trajectory
          {fetching && trend !== null && (
            <span
              aria-hidden="true"
              className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-primary/20 border-t-primary"
            />
          )}
        </h2>
        <RangeSelector value={range} onChange={setRange} />
      </div>

      <div
        className={`transition-opacity duration-150 ${fetching && trend !== null ? "opacity-50" : "opacity-100"}`}
      >
        {showInitialSpinner ? (
          <div className="flex items-center justify-center py-6">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
          </div>
        ) : !trend || trend.total_rounds === 0 ? (
          <EmptyState handicap={handicap} range={range} />
        ) : trend.total_rounds < MIN_ROUNDS_FOR_TREND ? (
          <EarlyState trend={trend} handicap={handicap} />
        ) : (
          <LoadedState trend={trend} range={range} />
        )}
      </div>
    </section>
  )
}

/* ── Range selector ──────────────────────────────────────── */

function RangeSelector({
  value,
  onChange,
}: {
  value: Range
  onChange: (r: Range) => void
}) {
  return (
    <div
      role="tablist"
      aria-label="Select time range"
      className="inline-flex rounded-full bg-primary/5 p-0.5"
    >
      {RANGE_OPTIONS.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors ${
              active
                ? "bg-white text-primary shadow-sm"
                : "text-primary/50 hover:text-primary/80"
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

/* ── States ──────────────────────────────────────────────── */

function EmptyState({
  handicap,
  range,
}: {
  handicap?: number | null
  range: Range
}) {
  const label =
    range === "week"
      ? "No rounds this week yet"
      : range === "month"
      ? "No rounds this month yet"
      : range === "year"
      ? "No rounds this year yet"
      : "No rounds yet"

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-primary/40">Handicap</p>
        <p className="text-3xl font-bold tabular-nums text-primary">
          {handicap != null ? handicap : "\u2013"}
        </p>
      </div>
      <p className="max-w-[180px] text-right text-[11px] text-primary/50">
        {label}
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
        <p className="text-xs uppercase tracking-wide text-primary/40">Last round</p>
        <p className="text-3xl font-bold tabular-nums text-primary">
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

function LoadedState({ trend, range }: { trend: ScoreTrendData; range: Range }) {
  const change = trend.change
  const improving = change != null && change < 0
  const unchanged = change != null && Math.abs(change) < 0.5

  const arrow = change == null || unchanged ? "·" : improving ? "\u25BC" : "\u25B2"
  const toneClass =
    change == null || unchanged
      ? "text-primary/40"
      : improving
      ? "text-emerald-600"
      : "text-red-500"

  const priorLabel =
    range === "week"
      ? "prior week"
      : range === "month"
      ? "prior month"
      : range === "year"
      ? "prior year"
      : trend.points.length >= 20
      ? "prior 10"
      : "prior rounds"

  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-primary/40">Average</p>
          <p className="text-3xl font-bold tabular-nums text-primary">
            {trend.recent_avg}
          </p>
          <p className="mt-0.5 text-[11px] text-primary/40">
            {trend.total_rounds} round{trend.total_rounds === 1 ? "" : "s"}
          </p>
        </div>
        {change != null && (
          <div className={`text-right text-xs ${toneClass}`}>
            <p className="font-semibold">
              {arrow} {Math.abs(change)}
              <span className="ml-1 text-[10px] font-normal">
                vs {priorLabel}
              </span>
            </p>
            <p className="mt-0.5 text-[10px] text-primary/40">
              {improving
                ? "Scoring better"
                : unchanged
                ? "Holding steady"
                : "Scoring higher"}
            </p>
          </div>
        )}
      </div>

      {/* Chart with Y-axis every 10 strokes and X-axis date ticks */}
      <div className="mt-3 h-36">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={trend.points}
            margin={{ top: 6, right: 8, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(15,61,46,0.08)"
              vertical={false}
            />
            <YAxis
              ticks={computeYTicks(trend.points)}
              domain={computeYDomain(trend.points)}
              tick={{ fontSize: 10, fill: "rgba(15,61,46,0.5)" }}
              axisLine={false}
              tickLine={false}
              width={36}
            />
            <XAxis
              dataKey="date"
              tickFormatter={(d) =>
                new Date(d).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })
              }
              tick={{ fontSize: 10, fill: "rgba(15,61,46,0.5)" }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={36}
            />
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

/* ── Tooltip ─────────────────────────────────────────────── */

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

/* ── Y-axis helpers ──────────────────────────────────────── */

function computeYTicks(points: ScoreTrendPoint[]): number[] {
  if (points.length === 0) return []
  const scores = points.map((p) => p.score)
  const min = Math.floor(Math.min(...scores) / 10) * 10
  const max = Math.ceil(Math.max(...scores) / 10) * 10
  const ticks: number[] = []
  for (let v = min; v <= max; v += 10) ticks.push(v)
  return ticks
}

function computeYDomain(points: ScoreTrendPoint[]): [number, number] | [string, string] {
  if (points.length === 0) return ["auto", "auto"]
  const scores = points.map((p) => p.score)
  const min = Math.floor(Math.min(...scores) / 10) * 10
  const max = Math.ceil(Math.max(...scores) / 10) * 10
  return [min, max]
}
