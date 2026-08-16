// Pairs a video clip's `activated_loras` (a list of LoRA filenames) with its
// `loras_multipliers` (one string, often empty) into named rows - one row
// per LoRA, name and multiplier together, instead of two parallel lists the
// reader has to match up by position themselves.
//
// The pairing rule mirrors Wan2GP's own rendering rather than inventing one:
// wgp.py:4948 zips the activated-LoRA list against the parsed multiplier
// list (padded with empty strings out to the LoRA count) and renders
// `x{multiplier if len(multiplier)>0 else '1'}` - positional, defaulting to
// '1' when a slot is empty or missing. The multiplier-string splitting is
// `preparse_loras_multipliers` in
// Wan2GP/shared/utils/loras_mutipliers.py:4-12: strip the ends, split on
// newlines, drop blank lines and lines starting with '#', rejoin with
// spaces, replace '|' with a space, then split on spaces.

export interface LoraRow {
  name: string
  multiplier: string
}

const stripSpaceCrLf = (s: string): string =>
  s.replace(/^[ \r\n]+/, '').replace(/[ \r\n]+$/, '')

// Mirrors preparse_loras_multipliers (loras_mutipliers.py:4-12) for the
// string-input case - activated_loras/loras_multipliers come from JSON, so
// the list-input branch of that function never applies here.
const splitLoraMultipliers = (raw: string): string[] => {
  const stripped = stripSpaceCrLf(raw)
  const lines = stripped.replace(/\r/g, '').split('\n')
  const kept = lines
    .filter(line => line.length > 0 && !line.startsWith('#'))
    .map(line => line.trim())
  const joined = kept.join(' ')
  return joined.replace(/\|/g, ' ').trim().split(' ')
}

export function pairLoras(activated: unknown, multipliers: unknown): LoraRow[] {
  if (!Array.isArray(activated) || activated.length === 0) return []
  const raw = typeof multipliers === 'string' ? multipliers : ''
  const parsed = splitLoraMultipliers(raw)
  return activated.map((name, i) => {
    const m = parsed[i] ?? ''
    return { name: String(name), multiplier: m.length > 0 ? m : '1' }
  })
}
