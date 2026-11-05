import { CLICK_KEY, isClickSource } from '../key.js'
import { CLICK_GOAL_COPY as C } from './copy.js'

export interface ClickGoal { id: string | number; name: string; slug: string; source: string }
export type PickerStatus = 'loading' | 'ready' | 'not-manager' | 'error'

export function goalSlug(name: string): string {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
export function clickGoalSlug(name: string): string { return goalSlug(name).slice(0, 64).replace(/[-_]+$/, '') }
export function definedClickGoals(rows: readonly ClickGoal[]): ClickGoal[] { return rows.filter(row => isClickSource(row.source)) }
export function undefinedClickKey(status: PickerStatus, goals: readonly ClickGoal[], value: string): boolean {
  return status === 'ready' && Boolean(value) && !goals.some(goal => goal.slug === value)
}
export function clickGoalBody(name: string, slug: string) {
  return { name: name.trim(), slug, source: `click:${slug}`, direction: 'increase',
    attributionWindowHours: 168, minSampleSize: 150, capping: { type: null, value: null } }
}

/** Payload nests field errors in data.errors; never show its raw message. */
export function hasSlugError(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  const value = body as { path?: unknown; errors?: unknown; data?: unknown }
  if (value.path === 'slug') return true
  return (Array.isArray(value.errors) && value.errors.some(hasSlugError)) || hasSlugError(value.data)
}
export function clickGoalCreateError(slug: string, body?: unknown): { slug?: string; general?: string } {
  if (!CLICK_KEY.test(slug)) return { slug: C.slugRule }
  if (hasSlugError(body)) return { slug: C.duplicateSlug }
  return { general: C.saveError }
}
