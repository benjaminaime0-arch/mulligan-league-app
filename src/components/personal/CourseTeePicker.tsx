"use client"
import { useT } from "@/lib/i18n"
import { personalInput, type PersonalTee } from "@/lib/personalRounds"

/** Keep the tee ID as the only selected value, including deep-link presets. */
export function CourseTeePicker({ tees, value, onChange, disabled = false }: {
  tees: PersonalTee[]
  value: string
  onChange: (id: string) => void
  disabled?: boolean
}) {
  const t = useT()
  const selected = tees.find(x => x.id === value)
  const courses = Array.from(new Map(tees.map(x => [x.course_id, x.course_name])))
  const configurations = Array.from(new Set(tees.filter(x => x.course_id === selected?.course_id).map(x => x.hole_count))).sort((a, b) => a - b)
  const prefer = (choices: PersonalTee[]) => choices.find(x => x.name === selected?.name) ?? choices.find(x => x.ready) ?? choices[0]
  return <div className="space-y-3">
    <label className="block text-sm font-medium">{t("personal.picker.course")}
      <select className={personalInput} value={selected?.course_id ?? ""} disabled={disabled || !tees.length} required onChange={e => {
        const choices = tees.filter(x => x.course_id === e.target.value)
        const next = prefer(choices.filter(x => x.hole_count === selected?.hole_count)) ?? prefer(choices)
        if (next) onChange(next.id)
      }}>
        {!selected && <option value="">{t("personal.picker.choose")}</option>}
        {courses.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
    </label>
    <div className="grid grid-cols-[1fr_1.6fr] gap-3">
      <label className="block text-sm font-medium">{t("personal.picker.holes")}
        <select className={personalInput} value={selected?.hole_count ?? ""} disabled={disabled || !selected} required onChange={e => {
          const next = prefer(tees.filter(x => x.course_id === selected?.course_id && x.hole_count === Number(e.target.value)))
          if (next) onChange(next.id)
        }}>
          {!selected && <option value="">—</option>}
          {configurations.map(n => <option key={n} value={n}>{t("personal.picker.holeCount", { n })}</option>)}
        </select>
      </label>
      <label className="block text-sm font-medium">{t("personal.picker.tee")}
        <select className={personalInput} value={value} disabled={disabled || !selected} required onChange={e => onChange(e.target.value)}>
          {!selected && <option value="">—</option>}
          {tees.filter(x => x.course_id === selected?.course_id && x.hole_count === selected?.hole_count).map(x => <option key={x.id} value={x.id}>{x.name}{!x.ready ? ` (${t("personal.ratingPending")})` : ""}</option>)}
        </select>
      </label>
    </div>
  </div>
}
