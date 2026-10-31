import type { Arm, ExperimentKind } from '../../types/contracts.js'
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
  const vocabulary = ['control', 'variantA', 'variantB', 'variantC', 'holdout']
  arms.forEach((arm, index) => {
    // The frozen issue union has no invalid-key code; key errors share duplicate-key.
    if (!vocabulary.includes(arm.key) || keys.has(arm.key)) issue('duplicate-key', 'Keys must be unique and use control, variantA, variantB, variantC or holdout.', index)
    keys.add(arm.key)
    if (kind === 'block') {
      if (!arm.slot || String(arm.slot) !== arm.key) issue('slot-required', 'A block slot is required and must equal its arm key.', index)
      if (arm.slot && slots.has(arm.slot)) issue('duplicate-slot', 'Block slots must be unique.', index)
      if (arm.slot) slots.add(arm.slot)
    }
  })
  return issues
}
export function addHoldout(arms: Arm[]): Arm[] {
  if (arms.some(arm => arm.kind === 'holdout' || arm.key === 'holdout')) return arms
  const total = arms.reduce((sum, arm) => sum + arm.weight, 0)
  const shares = arms.map(arm => total > 0 ? arm.weight * 90 / total : 90 / arms.length)
  const weights = shares.map(Math.floor)
  const order = arms.map((_, index) => index).sort((a, b) =>
    (shares[b]! - weights[b]!) - (shares[a]! - weights[a]!) ||
    Number(arms[b]!.kind === 'control') - Number(arms[a]!.kind === 'control') || a - b)
  const remainder = 90 - weights.reduce((sum, weight) => sum + weight, 0)
  for (let i = 0; i < remainder && order.length; i++) weights[order[i % order.length]!]!++
  // ArmSlot's frozen type omits holdout; the brief requires slot === key for block arms.
  const holdout = { key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 10,
    ...(arms.some(arm => arm.slot !== undefined) ? { slot: 'holdout' as Arm['slot'] } : {}) } satisfies Arm
  return [...arms.map((arm, index) => ({ ...arm, weight: weights[index]! })), holdout]
}
