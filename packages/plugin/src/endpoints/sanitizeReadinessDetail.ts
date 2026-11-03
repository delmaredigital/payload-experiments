import type { ReadinessCode } from '../transitions/checkStart.js'

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
// The runtime's slug/key alphabet, bounded even for host-provided parameter keys.
const key = (value: unknown): value is string => typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value)
const arm = (value: unknown): value is string => typeof value === 'string' && ['control', 'variantA', 'variantB', 'variantC', 'holdout'].includes(value)
const failure = (value: unknown) => value === 'placements-failed' || value === 'forbidden' || value === 'not-found'

/** Summary details contain identifiers only. Project known shapes rather than
 * recursively copying host objects: titles, messages and placement detail are text.
 * Other checks use authored client fallbacks and need no detail (including slot
 * counts and layer capacity, which are not identifiers).
 */
export function sanitizeReadinessDetail(code: ReadinessCode, detail: unknown): unknown {
  switch (code) {
    case 'no-placements':
      return failure(detail) ? detail : undefined
    case 'page-target-unpublished':
      // Paths only: no query, fragment, whitespace, URL authority or encoded text.
      return typeof detail === 'string' && detail.length <= 128 && detail.startsWith('/')
        && !detail.includes('//') && !/[^A-Za-z0-9_/-]/.test(detail) ? detail : undefined
    case 'flag-params-invalid': {
      if (!Array.isArray(detail) || !detail.length || !detail.every(item => object(item) && arm(item.arm) && key(item.field))) return undefined
      return detail.map(item => ({ arm: item.arm, field: item.field }))
    }
    case 'flag-placement-missing': {
      if (failure(detail)) return detail
      if (!object(detail) || !Array.isArray(detail.missing) || !detail.missing.every(arm)
        || !Array.isArray(detail.placements) || !detail.placements.every(item => object(item) && arm(item.arm))) return undefined
      return { missing: detail.missing, placements: detail.placements.map(item => ({ arm: item.arm })) }
    }
    case 'undeclared-targeting-key':
    case 'invalid-targeting-rule':
      return object(detail) && Array.isArray(detail.attributes) && detail.attributes.length && detail.attributes.every(key)
        ? { attributes: detail.attributes } : undefined
    default:
      return undefined
  }
}
