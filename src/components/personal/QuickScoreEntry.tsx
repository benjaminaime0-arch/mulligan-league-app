"use client"
import { useRef } from "react"
import { AppIcon } from "@/components/ui/AppIcon"
import { useT } from "@/lib/i18n"
import { invalidScore, scoreChange, togglePickedUp } from "@/lib/personalCardFlow"
import { personalInput, type PersonalCard, type PersonalHole } from "@/lib/personalRounds"

export function QuickScoreEntry({ references, holes, disabled, onChange, onDone }: {
  references: PersonalCard["reference_holes"]; holes: PersonalHole[]; disabled: boolean
  onChange: (n: number, patch: Partial<PersonalHole>) => void; onDone: () => void
}) {
  const t = useT()
  const inputs = useRef(new Map<number, HTMLInputElement>())
  const next = (n: number) => {
    const input = inputs.current.get(n + 1)
    if (input) { input.focus(); input.select(); input.scrollIntoView({ block: "center", behavior: "smooth" }) }
    else {
      const missing = holes.find(h => h.completion === "not_played" || invalidScore(h))
      const unfinished = missing && inputs.current.get(missing.hole_number)
      if (unfinished) { unfinished.focus(); unfinished.select(); unfinished.scrollIntoView({ block: "center", behavior: "smooth" }) }
      else { inputs.current.get(n)?.blur(); onDone() }
    }
  }
  return <div className="grid gap-4 md:grid-cols-2">
    {[0, ...(references.length === 18 ? [9] : [])].map(start => <fieldset key={start} id={`holes-${start + 1}`} disabled={disabled} className="app-surface min-w-0 scroll-mt-20 overflow-hidden">
      <legend className="sr-only">{t("personal.ui.hole")} {start + 1}–{start + 9}</legend>
      <h3 className="border-b border-primary/10 bg-sage/25 px-3 py-3 text-sm font-bold">{t("personal.ui.hole")} {start + 1}–{start + 9}</h3>
      <div aria-hidden="true" className="grid grid-cols-[28px_40px_minmax(0,1fr)_44px_44px] items-center gap-1.5 border-b border-primary/10 px-3 py-2 text-[11px] text-primary/70"><span>{t("personal.ui.hole")}</span><span>Par /<br />{t("personal.ui.index")}</span><span className="text-center">{t("personal.ui.strokes")}</span><span className="text-center">{t("cardFlow.pickedUpShort")}</span><span /></div>
      {references.slice(start,start + 9).map(ref => {
        const hole = holes.find(h => h.hole_number === ref.hole_number)!
        const invalid = invalidScore(hole)
        return <div key={ref.hole_number} className="border-b border-primary/5 last:border-0">
          <div className="grid grid-cols-[28px_40px_minmax(0,1fr)_44px_44px] items-center gap-1.5 px-3 py-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/5 text-xs font-bold">{ref.hole_number}</span>
            <span className="text-xs text-primary/70">{ref.par} / {ref.stroke_index ?? "—"}</span>
            <input ref={el => { if (el) inputs.current.set(ref.hole_number,el); else inputs.current.delete(ref.hole_number) }}
              aria-label={t("personal.holeScore", { n: ref.hole_number })} aria-invalid={invalid} aria-describedby={invalid ? `score-error-${ref.hole_number}` : undefined}
              className={`${personalInput} !mt-0 !px-1 text-center !text-xl font-bold tabular-nums !bg-sage/20 ${invalid ? "!border-red-600" : ""}`}
              type="number" inputMode="numeric" enterKeyHint={ref.hole_number === references.length ? "done" : "next"} min={1} max={30} step={1}
              placeholder={hole.completion === "picked_up" ? t("cardFlow.pickedUpShort") : "—"} value={hole.strokes ?? ""}
              onFocus={event => event.currentTarget.select()} onChange={event => onChange(ref.hole_number,scoreChange(event.target.value))}
              onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); next(ref.hole_number) } }} />
            <button type="button" aria-pressed={hole.completion === "picked_up"} aria-label={t("cardFlow.pickedUpHole", { n: ref.hole_number })} title={t("personal.hole.picked_up")}
              className={`h-11 w-11 rounded-xl text-xs font-bold ${hole.completion === "picked_up" ? "bg-primary text-white" : "border border-primary/15 text-primary/65"}`}
              onClick={() => onChange(ref.hole_number,togglePickedUp(hole))}>{t("cardFlow.pickedUpShort")}</button>
            <button type="button" className="flex h-11 w-11 items-center justify-center rounded-xl text-primary/65 hover:bg-sage/30" aria-label={t(ref.hole_number === references.length ? "cardFlow.finishEntry" : "cardFlow.nextHole", { n: ref.hole_number + 1 })} onClick={() => next(ref.hole_number)}><AppIcon name={ref.hole_number === references.length ? "check" : "arrow"} className="h-4 w-4" /></button>
          </div>
          {invalid && <p id={`score-error-${ref.hole_number}`} role="alert" className="px-3 pb-2 text-xs text-red-700">{t("cardFlow.scoreRange")}</p>}
        </div>
      })}
    </fieldset>)}
  </div>
}
