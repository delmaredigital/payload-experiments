import { evaluateOp } from '../targeting/ops.js'
import type { Attributes, ExperimentsPluginOptions, TargetingRule } from '../types/contracts.js'

export type AttributeKeys = NonNullable<ExperimentsPluginOptions['attributeKeys']>

/** Frozen manifest types take precedence; declarations still support draft rules. */
export function evaluateTargeting(rules: readonly (TargetingRule & { type?: 'string' | 'number' | 'boolean' })[], attributes: Attributes, attributeKeys?: AttributeKeys): boolean {
  return rules.every(rule => {
    if (!Object.hasOwn(attributes, rule.attribute)) return false
    if (rule.type === undefined && attributeKeys && !Object.hasOwn(attributeKeys, rule.attribute)) return false
    const type = rule.type ?? attributeKeys?.[rule.attribute]?.type ?? (Array.isArray(rule.value) ? 'string' : typeof rule.value)
    return evaluateOp(type, rule.op, attributes[rule.attribute], rule.value)
  })
}
