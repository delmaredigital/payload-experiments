import type { ReadinessCode } from './types/endpoints.js'

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
// The runtime's slug/key alphabet, bounded even for host-provided parameter keys.
const key = (value: unknown): value is string => typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value)
const arm = (value: unknown): value is string => typeof value === 'string' && ['control', 'variantA', 'variantB', 'variantC', 'holdout'].includes(value)
const path = (value: unknown): value is string => typeof value === 'string' && value.length <= 128 && value.startsWith('/')
  && !value.includes('//') && !/[^A-Za-z0-9_/-]/.test(value)
const failure = (value: unknown) => value === 'placements-failed' || value === 'forbidden' || value === 'not-found'

/** Summary details contain identifiers only. Project known shapes rather than
 * recursively copying host objects: titles, messages and placement detail are text.
 * Other checks use authored client fallbacks and need no detail (including slot
 * counts and layer capacity, which are not identifiers).
 */
export function sanitizeReadinessDetail(code: ReadinessCode, detail: unknown): unknown {
  switch (code) {
    case 'placement-unpublished':
    case 'duplicate-version-row':
    case 'interacting-tests':
      return Array.isArray(detail) ? detail.filter(object).map(row => Object.fromEntries(Object.entries(row).filter(([k, v]) => ['collection', 'id', 'experimentId', 'slug'].includes(k) ? key(v) || typeof v === 'number' && Number.isSafeInteger(v) : k === 'path' ? path(v) : k === 'status' ? ['running', 'decided'].includes(String(v)) : k === 'version' && typeof v === 'boolean'))) : undefined
    case 'version-same-address':
      return object(detail) && arm(detail.arm) && arm(detail.otherArm) && path(detail.path)
        ? { arm: detail.arm, otherArm: detail.otherArm, path: detail.path } : undefined
    case 'version-identical':
      return object(detail) && arm(detail.arm) && key(detail.collection) && (key(detail.id) || typeof detail.id === 'number' && Number.isSafeInteger(detail.id))
        ? { arm: detail.arm, collection: detail.collection, id: detail.id, ...(path(detail.path) ? { path: detail.path } : {}) } : undefined
    case 'block-path-rule':
      return object(detail) && Array.isArray(detail.rules) && detail.rules.length
        && detail.rules.every(index => Number.isSafeInteger(index) && index >= 0)
        ? { rules: detail.rules } : undefined
    case 'no-placements':
      return failure(detail) ? detail : undefined
    case 'page-in-use': {
      if (!object(detail) || !Array.isArray(detail.paths)) return undefined
      const paths = detail.paths.filter(path)
      return paths.length ? { paths } : undefined
    }
    case 'page-target-unpublished':
      // Paths only: no query, fragment, whitespace, URL authority or encoded text.
      return path(detail) ? detail : undefined
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
