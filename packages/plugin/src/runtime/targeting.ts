import { evaluateOp } from '../targeting/ops.js'
import type { Attributes, ExperimentsPluginOptions, TargetingRule } from '../types/contracts.js'

export type AttributeKeys = NonNullable<ExperimentsPluginOptions['attributeKeys']>

/** Rules are already typed by the collection; callers may additionally supply declarations. */
export function evaluateTargeting(rules: readonly TargetingRule[], attributes: Attributes, attributeKeys?: AttributeKeys): boolean {
  return rules.every(rule => {
    if (!Object.hasOwn(attributes, rule.attribute)) return false
    if (attributeKeys && !Object.hasOwn(attributeKeys, rule.attribute)) return false
    const type = attributeKeys?.[rule.attribute]?.type ?? (Array.isArray(rule.value) ? 'string' : typeof rule.value)
    return evaluateOp(type, rule.op, attributes[rule.attribute], rule.value)
  })
}
