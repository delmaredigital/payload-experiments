import { sanitizeFallbackLocale, type PayloadRequest } from 'payload'
import { flattenTopLevelFields } from 'payload/shared'
import { puckCollections } from '../options.js'
import { placementSlugs } from './bindings.js'
import { isObject } from './model.js'
import type { DocId, ResolvedOptions } from '../types/contracts.js'

/** Adapter rows retain locale maps; Start's Local API scan flattens these fields
 * to req.locale (and req.fallbackLocale). Registrations name top-level fields.
 * Match Payload afterRead/promise.js:50-89: [] is present, not a fallback.
 */
export function placementLocaleContent(req: PayloadRequest, collection: string, doc: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const localization = req.payload.config.localization
  if (!doc || !localization || req.locale === 'all') return doc
  const config = req.payload.config.collections?.find(entry => entry.slug === collection)
  if (!config) return doc
  const options = req.payload.config.custom!.xp as ResolvedOptions
  const names = new Set([...puckCollections(options).filter(entry => entry.slug === collection).map(entry => entry.field),
    ...(options.blocks?.collections ?? []).filter(entry => entry.slug === collection).map(entry => entry.field)])
  const result = { ...doc }
  const locale = req.locale || localization.defaultLocale
  const fallback = sanitizeFallbackLocale({ fallbackLocale: req.fallbackLocale ?? null, locale, localization })
  for (const field of flattenTopLevelFields(config.fields)) {
    if (!('name' in field) || typeof field.name !== 'string' || !names.has(field.name) || !('localized' in field) || !field.localized) continue
    const values = doc[field.name]
    if (!isObject(values)) continue
    let value = values[locale]
    if (value == null && fallback && fallback !== locale) {
      for (const code of Array.isArray(fallback) ? fallback : [fallback]) {
        if (values[code] != null && values[code] !== '') { value = values[code]; break }
      }
    }
    result[field.name] = value
  }
  return result
}

export interface PlacementLocaleView { locale: string; fallbackLocale: import('payload').TypedFallbackLocale }
export const placementDocumentKey = (collection: string, id: DocId, view: PlacementLocaleView) => JSON.stringify([collection, String(id), view])
export type RemovedPlacementViews = Map<string, PlacementLocaleView[]>
export function localeRequest(req: PayloadRequest, view: PlacementLocaleView): PayloadRequest {
  return { ...req, ...view }
}
/** Canonical views of registered content, without multiplying nonlocalized rows. */
export function placementLocaleViews(req: PayloadRequest, collection: string): PlacementLocaleView[] {
  const localization = req.payload.config.localization
  const config = req.payload.config.collections?.find(entry => entry.slug === collection)
  const options = req.payload.config.custom!.xp as ResolvedOptions
  const names = new Set([...puckCollections(options).filter(entry => entry.slug === collection).map(entry => entry.field),
    ...(options.blocks?.collections ?? []).filter(entry => entry.slug === collection).map(entry => entry.field)])
  const localized = config && flattenTopLevelFields(config.fields).some(field => 'name' in field && names.has(field.name!) && 'localized' in field && field.localized)
  return localization && localized
    ? localization.localeCodes.map(locale => ({ locale, fallbackLocale: sanitizeFallbackLocale({ fallbackLocale: null, locale, localization }) }))
    : [{ locale: '', fallbackLocale: false }]
}

/** Compare every locale view: a localized edit can also change fallback
 * content in another locale. Whole-row removals replace every view with absence.
 * The incoming hook document is already flattened to the writing locale.
 */
export function removedPlacementViews(req: PayloadRequest, collection: string, before: Record<string, unknown> | undefined,
  after: Record<string, unknown>, removingPage: boolean): RemovedPlacementViews {
  const result: RemovedPlacementViews = new Map()
  if (!before) return result
  const localization = req.payload.config.localization
  const config = req.payload.config.collections?.find(entry => entry.slug === collection)
  const options = req.payload.config.custom!.xp as ResolvedOptions
  const fields = config ? flattenTopLevelFields(config.fields) : []
  const localized = fields.filter(field => 'name' in field && 'localized' in field && field.localized)
  // Keep the raw locale maps for unchanged languages when merging a partial,
  // flattened main-row write back into the adapter baseline.
  const rawAfter = { ...after }
  if (localization && req.locale !== 'all') for (const field of localized) {
    if (!('name' in field) || typeof field.name !== 'string' || !(field.name in after)) continue
    const previousValue = before[field.name]
    rawAfter[field.name] = { ...(isObject(previousValue) ? previousValue : {}), [req.locale || localization.defaultLocale]: after[field.name] }
  }
  for (const view of placementLocaleViews(req, collection)) {
    const viewReq = localeRequest(req, view)
    const previous = placementSlugs(options, collection, placementLocaleContent(viewReq, collection, before))
    const next = removingPage ? [] : placementSlugs(options, collection, placementLocaleContent(viewReq, collection, rawAfter))
    for (const slug of previous.filter(slug => !next.includes(slug))) result.set(slug, [...(result.get(slug) ?? []), view])
  }
  return result
}
