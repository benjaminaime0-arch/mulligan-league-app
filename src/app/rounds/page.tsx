"use client"
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/useAuth"
import { useT } from "@/lib/i18n"
import { todayLocalIso } from "@/lib/date"
import { supabase } from "@/lib/supabase"
import {
  loadPersonalOverview,
  personalResult,
  personalInput,
  personalButton,
  type PersonalOverview,
} from "@/lib/personalRounds"
export default function PersonalRoundsPage() {
  const { user, loading } = useAuth()
  const t = useT()
  const router = useRouter()
  const [data, setData] = useState<PersonalOverview | null>(null)
  const [tee, setTee] = useState("")
  const [date, setDate] = useState(todayLocalIso)
  const [index, setIndex] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => {
    const d = await loadPersonalOverview()
    setData(d)
    setTee((v) => v || d.tees.find((x) => x.ready)?.id || d.tees[0]?.id || "")
  }, [])
  useEffect(() => {
    if (!user) return
    let active = true
    loadPersonalOverview()
      .then((d) => {
        if (active) {
          setData(d)
          const requested = new URLSearchParams(window.location.search).get(
            "tee",
          )
          setTee(
            d.tees.find((x) => x.id === requested)?.id ||
              d.tees.find((x) => x.ready)?.id ||
              d.tees[0]?.id ||
              "",
          )
        }
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
    }
  }, [user])
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : t("personal.loadError"))
    } finally {
      setBusy(false)
    }
  }
  if (loading || !user)
    return <main className="p-6">{t("common.loading")}</main>
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-2xl font-bold">{t("personal.cards")}</h1>
      <p className="mt-2 text-sm text-primary/70">{t("personal.intro")}</p>
      {error && (
        <p role="alert" className="my-4 text-sm text-red-700">
          {error}
        </p>
      )}
      {data && (
        <>
          {data.inbox.length > 0 && <section className="my-5 rounded-xl border border-amber-400 p-4">
            <h2 className="font-semibold">{t("personal.lifecycle.inbox")}</h2>
            <ul className="mt-3 space-y-2">{data.inbox.map((item) => <li key={item.id}><Link className="block underline" href={`/rounds/${item.id}`}>{item.player_name} · {item.course_name} · {item.played_on} · {t(`personal.status.${item.status}`)}</Link></li>)}</ul>
          </section>}
          <section className="my-5 rounded-xl border border-primary/15 bg-cream/40 p-4">
            <h2 className="font-semibold">{t("personal.level.title")}</h2>
            <p className="mt-1 text-3xl font-bold">{data.level.value ?? "—"}</p>
            <p className="text-sm">
              {t(`personal.level.${data.level.status}`)} ·{" "}
              {t("personal.level.count", { n: data.level.cards_count })}
            </p>
            <p className="mt-2 text-xs text-primary/70">
              {t("personal.level.explanation")}
            </p>
            <form
              className="mt-4 flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void run(async () => {
                  await supabase
                    .rpc("declare_personal_index", { p_index: Number(index) })
                    .then(personalResult)
                  setIndex("")
                  await reload()
                })
              }}
            >
              <label className="flex-1 text-sm">
                {t("personal.official")} ({data.official_index ?? "—"})
                <input
                  aria-label={t("personal.official")}
                  type="number"
                  step="0.1"
                  min="-10"
                  max="54"
                  required
                  value={index}
                  onChange={(e) => setIndex(e.target.value)}
                  className={personalInput}
                />
              </label>
              <button className={personalButton} disabled={busy}>
                {t("personal.updateIndex")}
              </button>
            </form>
            {data.history.length > 0 && (
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer">
                  {t("personal.level.history")}
                </summary>
                <ul className="mt-2 space-y-1">
                  {data.history.map((h, i) => (
                    <li key={i}>
                      {new Date(h.calculated_at).toLocaleDateString()} ·{" "}
                      {h.level_value ?? "—"} ·{" "}
                      {t("personal.level.count", { n: h.cards_count })}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
          <form
            className="mb-6 space-y-3 rounded-xl border border-primary/15 p-4"
            onSubmit={(e) => {
              e.preventDefault()
              void run(async () => {
                const r = personalResult<{ id: string }>(
                  await supabase.rpc("create_personal_round", {
                    p_tee: tee,
                    p_played_on: date,
                  }),
                )
                router.push(`/rounds/${r.id}`)
              })
            }}
          >
            <h2 className="font-semibold">{t("personal.new")}</h2>
            <label className="block text-sm">
              {t("personal.tee")}
              <select
                value={tee}
                onChange={(e) => setTee(e.target.value)}
                required
                className={personalInput}
              >
                {data.tees.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.course_name} · {x.hole_count} · {x.name}
                    {!x.ready ? ` (${t("personal.ratingPending")})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              {t("personal.playedOn")}
              <input
                type="date"
                required
                max={todayLocalIso()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={personalInput}
              />
            </label>
            {data.tees.find((x) => x.id === tee)?.ready === false && (
              <p className="text-xs text-amber-800">
                {t("personal.referencePending")}
              </p>
            )}
            <button className={personalButton} disabled={busy || !tee}>
              {t("personal.start")}
            </button>
          </form>
          <section>
            <h2 className="mb-3 font-semibold">{t("personal.history")}</h2>
            {data.rounds.length === 0 ? (
              <p className="text-sm text-primary/70">{t("personal.empty")}</p>
            ) : (
              <ul className="space-y-2">
                {data.rounds.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/rounds/${r.id}`}
                      className="block rounded-xl border border-primary/15 p-4 hover:bg-cream/40"
                    >
                      <span className="font-semibold">{r.course_name}</span>
                      <span className="block text-sm text-primary/70">
                        {r.played_on} · {r.hole_count} ·{" "}
                        {t(`personal.status.${r.status}`)}
                      </span>
                      {r.differential != null && (
                        <span className="mt-1 block text-sm">
                          {t("personal.differential")}: {r.differential}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      {!data && !error && <p className="mt-5">{t("common.loading")}</p>}
    </main>
  )
}
