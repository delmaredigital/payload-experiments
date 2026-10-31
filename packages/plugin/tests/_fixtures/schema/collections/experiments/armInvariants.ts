// Schema-only copy from main d292db4e74d036d15d012ce1b5892dc4ad1f5ba6; only external import paths adjusted.
import type { Arm, ExperimentKind } from '../../../../../src/types/contracts.js'
import type { ArmIssueCode } from '../../types/endpoints.js'

export interface ArmIssue { code: ArmIssueCode; armIndex?: number; armKey?: string; message: string }
export function checkArms(arms: Arm[], kind: ExperimentKind): ArmIssue[] {
  const issues: ArmIssue[] = []
  const issue = (code: ArmIssueCode, message: string, armIndex?: number) => {
    issues.push({ code, message, ...(armIndex === undefined ? {} : { armIndex, armKey: arms[armIndex]!.key }) })
  }
  if (arms.some(arm => !Number.isInteger(arm.weight) || arm.weight < 0) || arms.reduce((total, arm) => total + arm.weight, 0) !== 100) {
    issue('weights-total', 'Weights must be non-negative integers totalling exactly 100.')
  }
  if (arms.filter(arm => arm.kind === 'control').length !== 1) issue('control-count', 'Exactly one Original is required.')
  if (arms.some((arm, index) => arm.kind === 'control' && index !== 0)) issue('control-first', 'The Original must be first.')
  if (arms.filter(arm => arm.kind === 'holdout').length > 1) issue('holdout-count', 'Only one holdout is allowed.')
  if (arms.some((arm, index) => arm.kind === 'holdout' && index !== arms.length - 1)) issue('holdout-last', 'The holdout must be last.')
  if (arms.filter(arm => arm.kind === 'variant').length > 3) issue('variant-count', 'At most three variants are allowed.')
  const keys = new Set<string>(), slots = new Set<string>()
  const kinds: Record<string, string> = { control: 'control', variantA: 'variant', variantB: 'variant', variantC: 'variant', holdout: 'holdout' }
  arms.forEach((arm, index) => {
    if (!Object.hasOwn(kinds, arm.key) || kinds[arm.key] !== arm.kind) issue('invalid-key', 'Use control, variantA, variantB, variantC or holdout with its matching kind.', index)
    if (keys.has(arm.key)) issue('duplicate-key', 'Arm keys must be unique.', index)
    keys.add(arm.key)
    if (kind === 'block') {
      if (arm.kind === 'holdout') {
        if (arm.slot != null) issue('invalid-key', 'The holdout has no slot; it shows the Original.', index)
      } else {
        if (!arm.slot || arm.slot !== arm.key) issue('slot-required', 'A block slot is required and must equal its arm key.', index)
        if (arm.slot && slots.has(arm.slot)) issue('duplicate-slot', 'Block slots must be unique.', index)
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
