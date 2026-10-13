"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { useT } from "@/lib/i18n"
import { supabase } from "@/lib/supabase"
import { toLocalIso } from "@/lib/date"
import {
  cardIsComplete,
  holesAsJson,
  personalResult,
  personalInput,
  personalButton,
  type PersonalCard,
  type PersonalHole,
} from "@/lib/personalRounds"
export function PersonalRoundEditor({
  data,
  onReload,
}: {
  data: PersonalCard
  onReload: () => Promise<void>
}) {
  const t = useT()
  const makeHoles = () =>
    data.reference_holes.map(
      (h) =>
        data.holes.find((s) => s.hole_number === h.hole_number) ?? {
          hole_number: h.hole_number,
          completion: "not_played" as const,
          strokes: null,
        },
    )
  const [holes, setHoles] = useState<PersonalHole[]>(makeHoles)
  const [version, setVersion] = useState(data.round.draft_version)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [format, setFormat] = useState("stableford_net")
  const [cards, setCards] = useState(1)
  const [witness, setWitness] = useState(false)
  const [end, setEnd] = useState(() => {
    const d = new Date(`${data.round.played_on}T12:00:00`)
    d.setDate(d.getDate() + 30)
    return toLocalIso(d)
  })
  useEffect(() => {
    setHoles(
      data.reference_holes.map(
        (h) =>
          data.holes.find((s) => s.hole_number === h.hole_number) ?? {
            hole_number: h.hole_number,
            completion: "not_played",
            strokes: null,
          },
      ),
    )
    setVersion(data.round.draft_version)
    if (data.revision?.gross_total === null) setFormat("stableford_net")
  }, [data])
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : t("personal.loadError"))
    } finally {
      setBusy(false)
    }
  }
  const save = async () => {
    const res = personalResult<{ draft_version: number }>(
      await supabase.rpc("save_personal_card", {
        p_round: data.round.id,
        p_holes: holesAsJson(holes),
        p_expected_version: version,
      }),
    )
    setVersion(res.draft_version)
    return res.draft_version
  }
  const change = (n: number, patch: Partial<PersonalHole>) =>
    setHoles((prev) =>
      prev.map((h) => (h.hole_number === n ? { ...h, ...patch } : h)),
    )
  const complete = cardIsComplete(holes, data.tee.hole_count)
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <Link href="/rounds" className="text-sm underline">
        ← {t("personal.cards")}
      </Link>
      <h1 className="mt-3 text-2xl font-bold">{data.tee.course_name}</h1>
      <p className="mt-1 text-sm text-primary/70">
        {data.round.played_on} · {data.tee.hole_count} · {data.tee.name}
      </p>
      <p className="mt-3 text-sm">
        {t("personal.handicapSnapshot")}: {data.round.handicap_index} (
        {t(`personal.source.${data.round.handicap_source}`)})
      </p>
      {!data.tee.ready && (
        <p className="my-3 text-sm text-amber-800">
          {t("personal.referencePending")}
        </p>
      )}
      {data.tee.hole_count === 9 && (
        <p className="mt-2 text-xs text-primary/70">
          {t("personal.nineEstimate")}
        </p>
      )}
      {data.revision && (
        <section className="my-4 rounded-xl border border-primary/15 bg-cream/40 p-4">
          <h2 className="font-semibold">
            {t("personal.confirmedRevision", {
              n: data.revision.revision_number,
            })}
          </h2>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt>{t("personal.gross")}</dt>
              <dd className="font-bold">{data.revision.gross_total ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("personal.net")}</dt>
              <dd className="font-bold">{data.revision.net_total ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("personal.stableford")}</dt>
              <dd className="font-bold">{data.revision.stableford_points}</dd>
            </div>
            <div>
              <dt>{t("personal.differential")}</dt>
              <dd className="font-bold">{data.revision.differential}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm">
            {t("personal.level.title")}: {data.level.value ?? "—"} ·{" "}
            {t(`personal.level.${data.level.status}`)}
          </p>
          <p className="mt-2 text-xs text-primary/70">
            {t("personal.correctionNotice")}
          </p>
        </section>
      )}
      {error && (
        <p role="alert" className="my-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="my-3 text-sm text-emerald-800">
          {notice}
        </p>
      )}
      <fieldset disabled={busy} className="mt-5 space-y-3">
        <legend className="mb-3 font-semibold">
          {t("personal.enterScores")}
        </legend>
        {data.reference_holes.map((ref) => {
          const h = holes.find((x) => x.hole_number === ref.hole_number)!
          return (
            <div
              key={ref.hole_number}
              className="rounded-xl border border-primary/15 p-3"
            >
              <p className="mb-2 text-sm font-semibold">
                {t("personal.hole", { n: ref.hole_number })} · Par {ref.par} ·
                SI {ref.stroke_index ?? "—"}
              </p>
              <div className="flex gap-2">
                <label className="flex-1">
                  <span className="sr-only">
                    {t("personal.holeState", { n: ref.hole_number })}
                  </span>
                  <select
                    aria-label={t("personal.holeState", { n: ref.hole_number })}
                    className={personalInput}
                    value={h.completion}
                    onChange={(e) =>
                      change(ref.hole_number, {
                        completion: e.target
                          .value as PersonalHole["completion"],
                        strokes:
                          e.target.value === "completed"
                            ? (h.strokes ?? ref.par)
                            : null,
                      })
                    }
                  >
                    <option value="not_played">
                      {t("personal.hole.not_played")}
                    </option>
                    <option value="completed">
                      {t("personal.hole.completed")}
                    </option>
                    <option value="picked_up">
                      {t("personal.hole.picked_up")}
                    </option>
                  </select>
                </label>
                {h.completion === "completed" && (
                  <label className="w-24">
                    <span className="sr-only">
                      {t("personal.holeScore", { n: ref.hole_number })}
                    </span>
                    <input
                      aria-label={t("personal.holeScore", {
                        n: ref.hole_number,
                      })}
                      className={personalInput}
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max="30"
                      step="1"
                      value={h.strokes ?? ""}
                      onChange={(e) =>
                        change(ref.hole_number, {
                          strokes:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                )}
              </div>
            </div>
          )
        })}
      </fieldset>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className={personalButton}
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await save()
              setNotice(t("personal.saved"))
            })
          }
        >
          {t("personal.saveDraft")}
        </button>
        <button
          className={personalButton}
          disabled={busy || !complete || !data.tee.ready}
          onClick={() =>
            void run(async () => {
              const v = await save()
              personalResult(
                await supabase.rpc("confirm_personal_card", {
                  p_round: data.round.id,
                  p_expected_version: v,
                }),
              )
              await onReload()
              setNotice(t("personal.confirmed"))
            })
          }
        >
          {t("personal.confirm")}
        </button>
      </div>
      {!complete && (
        <p className="mt-2 text-xs text-primary/70">
          {t("personal.incomplete")}
        </p>
      )}
      {data.revision && (
        <section className="mt-8">
          <h2 className="font-semibold">{t("personal.submitTitle")}</h2>
          <p className="mt-2 text-sm text-primary/70">
            {t("personal.shareNotice")}
          </p>
          <ul className="mt-3 space-y-2">
            {data.leagues.map((g) => (
              <li
                key={g.id}
                className="rounded-xl border border-primary/15 p-3"
              >
                <Link
                  href={`/games/${g.id}`}
                  className="font-semibold underline"
                >
                  {g.name}
                </Link>
                {g.reason ? (
                  <p className="mt-1 text-xs text-amber-800">
                    {t(`personal.reason.${g.reason}`)}
                  </p>
                ) : g.submission_status ? (
                  <p className="mt-1 text-sm">
                    {t(`personal.submission.${g.submission_status}`)}
                  </p>
                ) : (
                  <>
                    <p className="my-2 text-xs">
                      {g.attestation === "peer_required"
                        ? t("personal.witnessRequired")
                        : t("personal.selfDeclared")}
                    </p>
                    <button
                      className={personalButton}
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const res = personalResult<{
                            success: boolean
                            reason?: string
                          }>(
                            await supabase.rpc("submit_personal_card", {
                              p_round: data.round.id,
                              p_game: g.id,
                            }),
                          )
                          if (!res.success)
                            throw new Error(t(`personal.reason.${res.reason}`))
                          await onReload()
                        })
                      }
                    >
                      {t("personal.submit")}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <details className="mt-5 rounded-xl border border-primary/15 p-4">
            <summary className="cursor-pointer font-semibold">
              {t("personal.createLeague")}
            </summary>
            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                void run(async () => {
                  const g = personalResult<{ game_id: string }>(
                    await supabase.rpc("create_personal_league", {
                      p_name: name,
                      p_tee: data.round.tee_id,
                      p_start: data.round.played_on,
                      p_end: end,
                      p_format: format,
                      p_cards: cards,
                      p_attestation: witness
                        ? "peer_required"
                        : "self_declared",
                    }),
                  )
                  const res = personalResult<{
                    success: boolean
                    reason?: string
                  }>(
                    await supabase.rpc("submit_personal_card", {
                      p_round: data.round.id,
                      p_game: g.game_id,
                    }),
                  )
                  await onReload()
                  if (!res.success)
                    throw new Error(t(`personal.reason.${res.reason}`))
                  setName("")
                  setNotice(t("personal.leagueCreated"))
                })
              }}
            >
              <label className="block text-sm">
                {t("personal.leagueName")}
                <input
                  required
                  maxLength={80}
                  className={personalInput}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                {t("personal.format")}
                <select
                  aria-label={t("personal.format")}
                  className={personalInput}
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                >
                  {["stroke_gross", "stroke_net", "stableford_net"].map((f) => (
                    <option
                      key={f}
                      value={f}
                      disabled={
                        data.revision?.gross_total === null &&
                        f !== "stableford_net"
                      }
                    >
                      {t(`personal.format.${f}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                {t("personal.endsOn")}
                <input
                  type="date"
                  className={personalInput}
                  required
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                {t("personal.requiredCards")}
                <input
                  type="number"
                  className={personalInput}
                  min={1}
                  max={20}
                  required
                  value={cards}
                  onChange={(e) => setCards(Number(e.target.value))}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={witness}
                  onChange={(e) => setWitness(e.target.checked)}
                />
                {t("personal.witnessRequired")}
              </label>
              <p className="text-xs text-primary/70">
                {t("personal.leagueRules")}
              </p>
              <button
                disabled={busy || !data.tee.ready}
                className={personalButton}
              >
                {t("personal.createAndSubmit")}
              </button>
            </form>
          </details>
        </section>
      )}
    </main>
  )
}
