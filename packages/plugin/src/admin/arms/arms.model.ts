import { addHoldout, checkArms } from '../../collections/experiments/armInvariants.js'
import type { ArmIssue } from '../../collections/experiments/armInvariants.js'
import type { Arm, ArmKey, ExperimentKind } from '../../types/contracts.js'
import { GROUP_LABELS } from '../copy/arms.js'

const VARIANTS = ['variantA', 'variantB', 'variantC'] as const

export function addVariant(arms: Arm[], kind?: ExperimentKind): Arm[] {
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
export function addHoldoutArm(arms: Arm[]): Arm[] { return addHoldout(arms) }

// Largest remainder, with equal fractional remainders awarded to Original first.
function distribute(arms: Arm[], total: number, proportional: boolean): Arm[] {
  if (!arms.length) return arms
  const weightTotal = arms.reduce((sum, arm) => sum + arm.weight, 0)
  const useWeights = proportional && weightTotal > 0
  const denominator = useWeights ? weightTotal : arms.length
  const numerators = arms.map(arm => (useWeights ? arm.weight : 1) * total)
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
  return distribute(arms.filter(arm => arm.kind !== 'holdout'), arms.reduce((sum, arm) => sum + arm.weight, 0), true)
}
export function splitEvenly(arms: Arm[]): Arm[] {
  const holdout = arms.find(arm => arm.kind === 'holdout')
  return [...distribute(arms.filter(arm => arm.kind !== 'holdout'), 100 - (holdout?.weight ?? 0), false), ...(holdout ? [holdout] : [])]
}
export function setWeight(arms: Arm[], key: ArmKey, weight: number): Arm[] {
  return arms.map(arm => arm.key === key ? { ...arm, weight } : arm)
}
export function issuesByRow(arms: Arm[], kind: ExperimentKind): { rows: ArmIssue[][]; form: ArmIssue[] } {
  const rows: ArmIssue[][] = arms.map(() => [])
  const form: ArmIssue[] = []
  for (const issue of checkArms(arms, kind)) {
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
    ARM_FIELDS.map(field => [field, fields[`${path}.${index}.${field}`]?.value]),
  ) as unknown as Arm)
}
