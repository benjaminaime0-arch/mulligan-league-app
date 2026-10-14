export function parseOfficialIndex(value: string): number | null {
  const normalized = value.trim().replace(",", ".")
  if (!normalized) return null
  if (!/^[+-]?\d+(\.\d)?$/.test(normalized)) throw new Error("invalid_official_index")
  const number = Number(normalized)
  if (!Number.isFinite(number) || number < -10 || number > 54) throw new Error("invalid_official_index")
  return number
}
