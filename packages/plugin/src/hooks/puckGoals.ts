import { ValidationError, type CollectionBeforeChangeHook } from 'payload'
import { validateClickGoal } from '../goals/validate.js'

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
    async function walk(value: unknown, path: string): Promise<void> {
      if (!value || typeof value !== 'object') return
      for (const [key, prop] of Object.entries(value)) {
        const propPath = `${path}.${key}`
        if (key === 'xpGoal' && typeof prop === 'string') {
          const result = await validateClickGoal(prop, req)
          if (result !== true) errors.push({ path: propPath, message: result })
        } else await walk(prop, propPath)
      }
    }
    await walk(value, field)
    if (errors.length) throw new ValidationError({ collection: collection.slug, errors })
    return data
  }
}
