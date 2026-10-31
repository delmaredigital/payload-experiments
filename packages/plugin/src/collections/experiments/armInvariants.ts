import type { Arm, ExperimentKind } from '../../types/contracts.js'
import type { ArmIssueCode } from '../../types/endpoints.js'

export interface ArmIssue { code: ArmIssueCode; armIndex?: number; armKey?: string; message: string }

/** The groups a new experiment starts with: Original 50 / Variant A 50, no holdout (spec §5.1, O4). Block slots equal the key. */
export function defaultArms(kind: ExperimentKind | undefined): Arm[] {
  const slot = (key: 'control' | 'variantA') => (kind === 'block' ? { slot: key } : {})
  return [
    { key: 'control', kind: 'control', label: 'Original', weight: 50, ...slot('control') } as Arm,
    { key: 'variantA', kind: 'variant', label: 'Variant A', weight: 50, ...slot('variantA') } as Arm,
  ]
}
export function checkArms(arms: Arm[], kind: ExperimentKind): ArmIssue[] {
  const issues: ArmIssue[] = []
  const issue = (code: ArmIssueCode, message: string, armIndex?: number) => {
    issues.push({ code, message, ...(armIndex === undefined ? {} : { armIndex, armKey: arms[armIndex]!.key }) })
  }
  if (arms.some(arm => !Number.isInteger(arm.weight) || arm.weight < 0) || arms.reduce((total, arm) => total + arm.weight, 0) !== 100) {
    issue('weights-total', 'Group shares must be whole numbers that add up to exactly 100.')
  }
  if (arms.filter(arm => arm.kind === 'control').length !== 1) issue('control-count', 'Exactly one Original is required.')
  if (arms.some((arm, index) => arm.kind === 'control' && index !== 0)) issue('control-first', 'The Original must be first.')
  if (arms.filter(arm => arm.kind === 'holdout').length > 1) issue('holdout-count', 'Only one Holdout is allowed.')
  if (arms.some((arm, index) => arm.kind === 'holdout' && index !== arms.length - 1)) issue('holdout-last', 'The Holdout must be the last group.')
  if (arms.filter(arm => arm.kind === 'variant').length > 3) issue('variant-count', 'At most three variants are allowed.')
  const keys = new Set<string>(), slots = new Set<string>()
  const kinds: Record<string, string> = { control: 'control', variantA: 'variant', variantB: 'variant', variantC: 'variant', holdout: 'holdout' }
  arms.forEach((arm, index) => {
    if (!Object.hasOwn(kinds, arm.key) || kinds[arm.key] !== arm.kind) issue('invalid-key', 'Each group must be the Original, Variant A, B or C, or the Holdout.', index)
    if (keys.has(arm.key)) issue('duplicate-key', 'Each group can appear only once.', index)
    keys.add(arm.key)
    if (kind === 'block') {
      if (arm.kind === 'holdout') {
        if (arm.slot != null) issue('invalid-key', 'The Holdout has no content of its own; it sees the Original.', index)
      } else {
        if (!arm.slot || arm.slot !== arm.key) issue('slot-required', 'Each Original and Variant needs its own content area.', index)
        if (arm.slot && slots.has(arm.slot)) issue('duplicate-slot', 'Two groups cannot share the same content area.', index)
        if (arm.slot) slots.add(arm.slot)
      }
    }
  })
  return issues
}
export function addHoldout(arms: Arm[]): Arm[] {
  if (arms.some(arm => arm.kind === 'holdout' || arm.key === 'holdout')) return arms
  const total = arms.reduce((sum, arm) => sum + arm.weight, 0)
  const denominator = total > 0 ? total : arms.length
  const numerators = arms.map(arm => (total > 0 ? arm.weight : 1) * 90)
  const weights = numerators.map(numerator => Math.floor(numerator / denominator))
  const remainders = numerators.map(numerator => numerator % denominator)
  const order = arms.map((_, index) => index).sort((a, b) =>
    remainders[b]! - remainders[a]! ||
    Number(arms[b]!.kind === 'control') - Number(arms[a]!.kind === 'control') || a - b)
  const remainder = 90 - weights.reduce((sum, weight) => sum + weight, 0)
  for (let i = 0; i < remainder && order.length; i++) weights[order[i % order.length]!]!++
  const holdout: Arm = { key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 10 }
  return [...arms.map((arm, index) => ({ ...arm, weight: weights[index]! })), holdout]
}
