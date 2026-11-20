import { sanitizeFallbackLocale, type Field, type PayloadRequest } from 'payload'
import { fieldShouldBeLocalized, flattenTopLevelFields } from 'payload/shared'
import { puckCollections } from '../options.js'
import { placementSlugs } from './bindings.js'
import { isObject } from './model.js'
import type { DocId, ResolvedOptions } from '../types/contracts.js'

/** Adapter and locale:'all' rows retain locale maps. Host editor predicates must
 * receive the same schema-flattened document as Start's per-locale Local API read.
 * Follow Payload afterRead's fallback order, text-empty handling and localized parents.
 */
export function placementLocaleContent(req: PayloadRequest, collection: string, doc: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const localization = req.payload.config.localization
  if (!doc || !localization || req.locale === 'all') return doc
  const config = req.payload.config.collections?.find(entry => entry.slug === collection)
  if (!config) return doc
  const locale = req.locale || localization.defaultLocale
  const fallback = sanitizeFallbackLocale({ fallbackLocale: req.fallbackLocale ?? null, locale, localization })
  function flatten(data: Record<string, unknown>, fields: Field[], parentIsLocalized = false): Record<string, unknown> {
    const result = { ...data }
    for (const field of flattenTopLevelFields(fields)) {
      if (!('name' in field) || !field.name) continue
      const localized = fieldShouldBeLocalized({ field, parentIsLocalized })
      let value = data[field.name]
      if (localized && isObject(value)) {
        const values = value
        value = values[locale]
        if (fallback && fallback !== locale && (value == null || (field.type === 'text' || field.type === 'textarea') && value === '')) {
          const candidate = Array.isArray(fallback)
            ? fallback.map(code => values[code]).find(value => value != null && value !== '') : values[fallback]
          if (candidate) value = candidate
        }
      }
      const localizedParent = parentIsLocalized || localized
      if ('fields' in field) {
        if (Array.isArray(value)) value = value.map(row => isObject(row) ? flatten(row, field.fields, localizedParent) : row)
        else if (isObject(value)) value = flatten(value, field.fields, localizedParent)
      } else if (field.type === 'blocks' && Array.isArray(value)) {
        value = value.map(row => {
          const block = isObject(row) && field.blocks.find(block => typeof block !== 'string' && block.slug === row.blockType)
          return isObject(row) && block && typeof block !== 'string' ? flatten(row, block.fields, localizedParent) : row
        })
      }
      if (field.name in data) result[field.name] = value
    }
    return result
  }
  return flatten(doc, config.fields)
}

export interface PlacementLocaleView { locale: string; fallbackLocale: import('payload').TypedFallbackLocale }
export const placementDocumentKey = (collection: string, id: DocId, view: PlacementLocaleView) => JSON.stringify([collection, String(id), view])
export type RemovedPlacementViews = Map<string, PlacementLocaleView[]>
export function localeRequest(req: PayloadRequest, view: PlacementLocaleView): PayloadRequest {
  // Fetch Request properties are prototype getters and disappear in a spread.
  // Local API setup needs headers/url; hooks also retain method and cancellation.
  return { ...req, headers: req.headers, url: req.url, method: req.method, signal: req.signal, ...view }
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
  const options = req.payload.config.custom!.xp as ResolvedOptions
  const rawAfter = mergedPlacementLocales(req, collection, before, after)
  for (const view of placementLocaleViews(req, collection)) {
    const viewReq = localeRequest(req, view)
    const previous = placementSlugs(options, collection, placementLocaleContent(viewReq, collection, before))
    const next = removingPage ? [] : placementSlugs(options, collection, placementLocaleContent(viewReq, collection, rawAfter))
    for (const slug of previous.filter(slug => !next.includes(slug))) result.set(slug, [...(result.get(slug) ?? []), view])
  }
  return result
}

/** Rebuild unchanged locale maps around a flattened hook write before reading each view. */
export function mergedPlacementLocales(req: PayloadRequest, collection: string, before: Record<string, unknown> | undefined,
  after: Record<string, unknown>): Record<string, unknown> {
  const localization = req.payload.config.localization
  const config = req.payload.config.collections?.find(entry => entry.slug === collection)
  const fields = config ? flattenTopLevelFields(config.fields) : []
  const localized = fields.filter(field => 'name' in field && 'localized' in field && field.localized)
  // Keep the raw locale maps for unchanged languages when merging a partial,
  // flattened main-row write back into the adapter baseline.
  const rawAfter = { ...after }
  if (localization && req.locale !== 'all') for (const field of localized) {
    if (!('name' in field) || typeof field.name !== 'string' || !(field.name in after)) continue
    const previousValue = before?.[field.name]
    rawAfter[field.name] = { ...(isObject(previousValue) ? previousValue : {}), [req.locale || localization.defaultLocale]: after[field.name] }
  }
  return rawAfter
}
