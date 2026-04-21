"use client"

import { Avatar } from "@/components/Avatar"
import {
  memberDisplayName,
  type MatchPlayer,
  type ScoreEdit,
} from "../types"

interface ScoreEditFormProps {
  players: MatchPlayer[]
  edits: Record<string, ScoreEdit>
  hasScores: boolean
  saving: boolean
  error: string | null
  onChange: (userId: string, patch: Partial<ScoreEdit>) => void
  onSave: () => void
  onCancel: () => void
}

/**
 * Batch edit form for submitting / updating scores for all players
 * in a match at once. Parent owns validation + the RPC call.
 */
export function ScoreEditForm({
  players,
  edits,
  hasScores,
  saving,
  error,
  onChange,
  onSave,
  onCancel,
}: ScoreEditFormProps) {
  return (
    <section className="rounded-xl border border-primary/15 bg-white p-4 shadow-sm">
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-primary">
          {hasScores ? "Edit scores" : "Submit scores"}
        </h2>
        <p className="text-xs text-primary/60">
          {hasScores
            ? "Update scores for all players. Saving resets other players\u2019 approvals."
            : "Enter scores for all players in this match."}
        </p>

        {error && (
          <div
            role="alert"
            className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {players.map((player) => {
          const edit: ScoreEdit = edits[player.user_id] || {
            score: "",
            holes: 18,
          }
          return (
            <div
              key={player.id}
              className="flex items-center gap-3 rounded-lg bg-cream p-3"
            >
              <div className="flex min-w-[120px] items-center gap-2">
                <Avatar
                  src={player.profiles?.avatar_url}
                  alt={`${memberDisplayName(player)}'s avatar`}
                  size={24}
                  fallback={memberDisplayName(player)}
                />
                <span className="text-sm font-medium text-primary">
                  {memberDisplayName(player)}
                </span>
              </div>
              <input
                type="number"
                inputMode="numeric"
                min={edit.holes === 9 ? 9 : 18}
                max={200}
                step={1}
                value={edit.score}
                onChange={(e) => onChange(player.user_id, { score: e.target.value })}
                className="w-20 rounded-lg border border-primary/20 bg-white px-2 py-1.5 text-center text-sm font-semibold text-primary focus:border-primary focus:outline-none"
                placeholder="Score"
                aria-label={`Score for ${memberDisplayName(player)}`}
                disabled={saving}
              />
              <div className="inline-flex rounded-full bg-white p-0.5">
                {[9, 18].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onChange(player.user_id, { holes: value as 9 | 18 })}
                    className={`min-w-[2.5rem] rounded-full px-2 py-1 text-[11px] font-medium ${
                      edit.holes === value
                        ? "bg-primary text-cream"
                        : "text-primary/60 hover:bg-primary/10"
                    }`}
                    disabled={saving}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          )
        })}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-cream hover:bg-primary/90 disabled:opacity-60"
          >
            {saving
              ? "Saving\u2026"
              : hasScores
              ? "Save All Scores"
              : "Submit Scores"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg border border-primary/20 bg-white px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/5"
          >
            Cancel
          </button>
        </div>
      </div>
    </section>
  )
}
