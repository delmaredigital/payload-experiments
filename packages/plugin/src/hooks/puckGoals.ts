import { ValidationError, type CollectionBeforeChangeHook } from 'payload'
import { validateClickGoal } from '../goals/validate.js'
import { CLICK_KEY } from '../goals/key.js'
import { puckGoalRefusal } from '../goals/picker/copy.js'

/** Host component labels are not passed to the plugin; display their type as words. */
export function puckBlockName(type: string): string {
  const words = type.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Za-z])([0-9])/g, '$1 $2').replace(/[\s_-]+/g, ' ').trim()
  return words ? words[0]!.toUpperCase() + words.slice(1) : 'Page'
}

/** Validate only the Puck JSON included in a publishing write. */
export function puckGoalsBeforeChange(field: string): CollectionBeforeChangeHook {
  return async function validatePuckGoals({ collection, data, originalDoc, req }) {
    const drafts = Boolean(collection.versions && collection.versions.drafts)
    if (drafts && data._status !== 'published') return data
    // Publishing a stored draft without resending its JSON publishes the draft's JSON.
    let value: unknown = data[field] !== undefined ? data[field] : drafts ? (originalDoc as Record<string, unknown> | undefined)?.[field] : undefined
    if (value === undefined) return data
    if (typeof value === 'string') {
      try { value = JSON.parse(value) } catch { return data }
    }
    const errors: Array<{ path: string; message: string }> = []
    let first: { key: string; block: string } | undefined
    async function walk(value: unknown, path: string, block = 'Page'): Promise<void> {
      if (!value || typeof value !== 'object') return
      const item = value as Record<string, unknown>
      if (typeof item.type === 'string' && item.props && typeof item.props === 'object' && !Array.isArray(item.props)) {
        block = puckBlockName(item.type)
      }
      for (const [key, prop] of Object.entries(value)) {
        const propPath = `${path}.${key}`
        if (key === 'xpGoal' && typeof prop === 'string') {
          const result = await validateClickGoal(prop, req)
          if (result !== true) {
            first ??= { key: prop, block }
            errors.push({ path: propPath, message: result })
          }
        } else await walk(prop, propPath, block)
      }
    }
    await walk(value, field)
    if (first) {
      const error = new ValidationError({ collection: collection.slug, errors })
      error.message = puckGoalRefusal(first.key, first.block, !CLICK_KEY.test(first.key), errors.length - 1)
      throw error
    }
    return data
  }
}
