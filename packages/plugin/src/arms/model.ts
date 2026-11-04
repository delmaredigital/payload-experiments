import { addHoldout, checkArms } from '../collections/experiments/armInvariants.js'
import type { ArmIssue } from '../collections/experiments/armInvariants.js'
import type { Arm, ArmKey, ExperimentKind } from '../types/contracts.js'
import { ARM_LABELS as GROUP_LABELS } from '../labels/arms.js'

const VARIANTS = ['variantA', 'variantB', 'variantC'] as const

export function defaultArms(kind?: ExperimentKind): Arm[] {
  return withSlotsFor([
    { key: 'control', kind: 'control', label: GROUP_LABELS.control, weight: 50 },
    { key: 'variantA', kind: 'variant', label: GROUP_LABELS.variantA, weight: 50 },
  ], kind)
}
/** Keep content slots in step with the experiment kind, including an unset kind. */
export function withSlotsFor(arms: Arm[], kind?: ExperimentKind): Arm[] {
  const next = arms.map(arm => {
    if (kind === 'block' && arm.kind !== 'holdout') return arm.slot === arm.key ? arm : { ...arm, slot: arm.key as Arm['slot'] }
    // Postgres returns null for unset columns; null counts as "no slot" so a loaded doc is not rewritten.
    if (arm.slot == null) return arm
    const { slot: _slot, ...rest } = arm
    return rest
  })
  return next.every((arm, index) => arm === arms[index]) ? arms : next
}
const finiteWeight = (weight: number) => Number.isFinite(weight) ? weight : 0
export function totalWeight(arms: Arm[]): number {
  return arms.reduce((sum, arm) => sum + finiteWeight(arm.weight), 0)
}
export function addVariant(arms: Arm[], kind?: ExperimentKind): Arm[] {
  if (!arms.some(arm => arm.kind === 'control')) return arms
  const key = VARIANTS.find(candidate => !arms.some(arm => arm.key === candidate))
  if (!key || arms.filter(arm => arm.kind === 'variant').length >= 3) return arms
  const block = kind === 'block' || kind === undefined && arms.some(arm => arm.slot !== undefined)
  const variant: Arm = { key, kind: 'variant', label: GROUP_LABELS[key], weight: 0, ...(block ? { slot: key } : {}) }
  const index = arms.findIndex(arm => arm.kind === 'holdout')
  const result = [...arms]
  result.splice(index < 0 ? arms.length : index, 0, variant)
  return result
}
export function removeArm(arms: Arm[], key: ArmKey): Arm[] {
  if (arms.some(arm => arm.key === key && arm.kind === 'control')) return arms
  if (key === 'holdout') return removeHoldout(arms)
  return arms.filter(arm => arm.key !== key)
}
export function addHoldoutArm(arms: Arm[]): Arm[] {
  if (!arms.some(arm => arm.kind === 'control') || arms.some(arm => arm.kind === 'holdout' || arm.key === 'holdout')) return arms
  return addHoldout(arms.map(arm => Number.isFinite(arm.weight) ? arm : { ...arm, weight: 0 }))
}

// Largest remainder, with equal fractional remainders awarded to Original first.
function distribute(arms: Arm[], total: number, proportional: boolean): Arm[] {
  if (!arms.length) return arms
  const weightTotal = totalWeight(arms)
  const useWeights = proportional && weightTotal > 0
  const denominator = useWeights ? weightTotal : arms.length
  const numerators = arms.map(arm => (useWeights ? finiteWeight(arm.weight) : 1) * total)
  const weights = numerators.map(numerator => Math.floor(numerator / denominator))
  const order = arms.map((_, i) => i).sort((a, b) =>
    numerators[b]! % denominator - numerators[a]! % denominator ||
    Number(arms[b]!.kind === 'control') - Number(arms[a]!.kind === 'control') || a - b)
  const remainder = total - weights.reduce((sum, weight) => sum + weight, 0)
  for (let i = 0; i < remainder; i++) weights[order[i % order.length]!]!++
  return arms.map((arm, i) => ({ ...arm, weight: weights[i]! }))
}
export function removeHoldout(arms: Arm[]): Arm[] {
  if (!arms.some(arm => arm.kind === 'holdout')) return arms
  return distribute(arms.filter(arm => arm.kind !== 'holdout'), totalWeight(arms), true)
}
export function splitEvenly(arms: Arm[]): Arm[] {
  const holdout = arms.find(arm => arm.kind === 'holdout')
  const weight = finiteWeight(holdout?.weight ?? 0)
  return [...distribute(arms.filter(arm => arm.kind !== 'holdout'), 100 - weight, false), ...(holdout ? [{ ...holdout, weight }] : [])]
}
export function setWeight(arms: Arm[], key: ArmKey, weight: number): Arm[] {
  return arms.map(arm => arm.key === key ? { ...arm, weight } : arm)
}
export function issuesByRow(arms: Arm[], kind?: ExperimentKind): { rows: ArmIssue[][]; form: ArmIssue[] } {
  const rows: ArmIssue[][] = arms.map(() => [])
  const form: ArmIssue[] = []
  for (const issue of checkArms(arms, kind as ExperimentKind)) {
    const index = issue.armIndex ?? arms.findIndex(arm => arm.key === issue.armKey)
    if (index >= 0 && index < arms.length) rows[index]!.push(issue)
    else form.push(issue)
  }
  return { rows, form }
}

export const ARM_FIELDS = ['key', 'label', 'weight', 'kind', 'slot', 'params', 'pageTarget'] as const
/** Payload arrays store each row's values at separate field paths. */
export function readArms(fields: Record<string, { value?: unknown }>, path = 'arms'): Arm[] {
  const indices = new Set<number>()
  for (const name of Object.keys(fields)) {
    if (!name.startsWith(`${path}.`)) continue
    const [index, field] = name.slice(path.length + 1).split('.')
    if (/^\d+$/.test(index!) && field === 'key') indices.add(Number(index))
  }
  return [...indices].sort((a, b) => a - b).map(index => Object.fromEntries(
    ARM_FIELDS.flatMap(field => {
      const value = fields[`${path}.${index}.${field}`]?.value
      return value === undefined ? [] : [[field, value]]
    }),
  ) as unknown as Arm)
}

/** Keep the edited share exact and distribute the remaining whole percentages proportionally. */
export function balanceWeight(arms: Arm[], key: ArmKey, weight: number): Arm[] {
  if (!arms.some(arm => arm.key === key) || !Number.isInteger(weight) || weight < 0 || weight > 100) return arms
  const others = arms.filter(arm => arm.key !== key)
  if (!others.length) return arms
  const total = others.reduce((sum, arm) => sum + Math.max(0, Number.isFinite(arm.weight) ? arm.weight : 0), 0)
  const denominator = total || others.length
  const raw = others.map(arm => (total ? Math.max(0, Number.isFinite(arm.weight) ? arm.weight : 0) : 1) * (100 - weight) / denominator)
  const whole = raw.map(Math.floor)
  const order = raw.map((_, i) => i).sort((a, b) => raw[b]! - whole[b]! - (raw[a]! - whole[a]!) || a - b)
  const remainder = 100 - weight - whole.reduce((sum, value) => sum + value, 0)
  for (let i = 0; i < remainder; i++) whole[order[i]!]!++
  const shares = new Map(others.map((arm, i) => [arm.key, whole[i]!]))
  return setWeight(arms, key, weight).map(arm => shares.has(arm.key) ? { ...arm, weight: shares.get(arm.key)! } : arm)
}
