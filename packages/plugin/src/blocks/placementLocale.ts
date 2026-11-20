import { sanitizeFallbackLocale, type Field, type PayloadRequest } from 'payload'
import { fieldShouldBeLocalized, flattenTopLevelFields } from 'payload/shared'
import { documentEditor, puckCollections } from '../options.js'
import { placementSlugs } from './bindings.js'
import { contentBlocks, hasLocalizedFields } from '../transitions/contentFields.js'
import { isObject } from './model.js'
import type { DocId, ResolvedOptions } from '../types/contracts.js'

export type PlacementInput = 'all-locales' | 'localized'

/** Compile only schema-marked localized branches. Opaque field values are never traversed.
 * Copy ancestors only when a localized descendant changes; ordinary branches retain identity.
 */
function localeTransform(req: PayloadRequest, collection: string, locale: string, fallback: import('payload').TypedFallbackLocale) {
  const config = req.payload.config.collections?.find(entry => entry.slug === collection)
  const blocks = req.payload.config.blocks ?? []
  type Transform = (data: Record<string, unknown>, write?: boolean, previous?: Record<string, unknown>) => Record<string, unknown>
  const compiled = new Map<Field[], Transform>()
  function compile(fields: Field[], parentIsLocalized = false): Transform {
    if (parentIsLocalized) return data => data
    const cached = compiled.get(fields)
    if (cached) return cached
    let project: Transform
    const transform: Transform = (data, write, previous) => project(data, write, previous)
    compiled.set(fields, transform)
    const steps = flattenTopLevelFields(fields).flatMap(field => {
      if (!('name' in field) || !field.name) return []
      const name = field.name
      const localized = fieldShouldBeLocalized({ field, parentIsLocalized })
      const parent = parentIsLocalized || localized
      const children = 'fields' in field && hasLocalizedFields(field.fields, req.payload.config) && ['group', 'array', 'tab'].includes(field.type) ? compile(field.fields, parent) : undefined
      const variants = field.type === 'blocks' ? new Map([...(field.blocks ?? []), ...(field.blockReferences ?? [])].flatMap(ref => {
        const block = typeof ref === 'string' ? blocks.find(block => block.slug === ref) : ref
        return block && hasLocalizedFields(block.fields, req.payload.config) ? [[block.slug, compile(block.fields, parent)] as const] : []
      })) : undefined
      if (!localized && !children && !variants) return []
      return [(data: Record<string, unknown>, write: boolean, previous?: Record<string, unknown>) => {
        if (!(name in data)) return data
        let value = data[name]
        const prior = previous?.[name]
        if (localized && write) value = { ...(isObject(prior) ? prior : {}), [locale]: value }
        else {
          if (localized) {
            const values = isObject(value) ? value : {}
            value = values[locale]
            if (fallback && fallback !== locale && (value == null || (field.type === 'text' || field.type === 'textarea') && value === '')) {
              for (const code of Array.isArray(fallback) ? fallback : [fallback]) {
                const candidate = values[code]
                if (candidate != null && candidate !== '') { value = candidate; break }
              }
            }
          }
          const visit = (row: unknown, old?: unknown) => {
            if (!isObject(row)) return row
            const transform = children ?? (variants && typeof row.blockType === 'string' ? variants.get(row.blockType) : undefined)
            return transform ? transform(row, write, isObject(old) ? old : undefined) : row
          }
          if (children || variants) {
            if (Array.isArray(value)) {
              const rows = value.map((row, index) => visit(row, Array.isArray(prior) ? prior.find(old => isObject(row) && isObject(old) && row.id != null && old.id === row.id) ?? prior[index] : undefined))
              if (rows.some((row, index) => row !== (value as unknown[])[index])) value = rows
            } else value = visit(value, prior)
          }
        }
        return value === data[name] ? data : { ...data, [name]: value }
      }]
    })
    project = (data, write = false, previous) => steps.reduce((result, step) => step(result, write, previous), data)
    return transform
  }
  return config && hasLocalizedFields(config.fields ?? [], req.payload.config) ? compile(config.fields ?? []) : (data: Record<string, unknown>) => data
}

export function placementLocaleContent(req: PayloadRequest, collection: string, doc: Record<string, unknown> | undefined, input: PlacementInput): Record<string, unknown> | undefined {
  return placementReader(req, collection).read(doc, input).doc
}

/** The single document → locale view → editor/placements boundary. Compile once per collection scan.
 * Local API and form documents explicitly bypass all-locale projection.
 */
export function placementReader(req: PayloadRequest, collection: string, options = req.payload.config.custom?.xp as Pick<ResolvedOptions, 'puck' | 'blocks'>) {
  const views = placementLocaleViews(req, collection)
  const transforms = new Map<string, ReturnType<typeof localeTransform>>()
  return { views, documentViews: schemaLocaleViews(req, collection), read(doc: Record<string, unknown> | null | undefined, input: PlacementInput, view?: PlacementLocaleView) {
    const requested = view ?? { locale: req.locale ?? '', fallbackLocale: req.fallbackLocale ?? false }
    const selected = requested.locale === 'all' ? { ...requested, locale: req.payload.config.localization ? req.payload.config.localization.defaultLocale : '' } : requested
    let content: Record<string, unknown> | undefined, resolved = false
    const resolve = () => {
      if (resolved) return content
      resolved = true
      content = doc ?? undefined
      if (doc && input === 'all-locales' && req.payload.config.localization && selected.locale !== 'all') {
        const locale = selected.locale || req.payload.config.localization.defaultLocale
        const key = JSON.stringify([locale, selected.fallbackLocale])
        let transform = transforms.get(key)
        if (!transform) {
          transform = localeTransform(req, collection, locale, sanitizeFallbackLocale({ fallbackLocale: selected.fallbackLocale, locale, localization: req.payload.config.localization }))
          transforms.set(key, transform)
        }
        content = transform(doc)
      }
      return content
    }
    let editor: ReturnType<typeof documentEditor> | undefined, slugs: string[] | undefined
    return { view: selected, get doc() { return resolve() },
      get editor() { return editor ??= doc ? documentEditor(options ?? {}, collection, resolve()!) : 'page' },
      get slugs() { return slugs ??= placementSlugs(options ?? {}, collection, resolve()) },
    }
  } }
}

export function allPlacementSlugs(req: PayloadRequest, collection: string, doc: Record<string, unknown> | undefined, input: PlacementInput): string[] {
  const reader = placementReader(req, collection)
  return [...new Set(reader.views.flatMap(view => reader.read(doc, input, view).slugs))]
}

export interface PlacementLocaleView { locale: string; fallbackLocale: import('payload').TypedFallbackLocale }
export const placementDocumentKey = (collection: string, id: DocId, view: PlacementLocaleView) => JSON.stringify([collection, String(id), view])
export type RemovedPlacementViews = Map<string, PlacementLocaleView[]>
export function localeRequest(req: PayloadRequest, view: PlacementLocaleView): PayloadRequest {
  // Fetch Request properties are prototype getters and disappear in a spread.
  // Local API setup needs headers/url; hooks also retain method and cancellation.
  return { ...req, headers: req.headers, url: req.url, method: req.method, signal: req.signal, ...view }
}
/** Audits may contain localized arm-select tags outside registered editors. */
function schemaLocaleViews(req: PayloadRequest, collection: string): PlacementLocaleView[] {
  const localization = req.payload.config.localization
  const config = req.payload.config.collections?.find(entry => entry.slug === collection)
  return localization && hasLocalizedFields(config?.fields ?? [], req.payload.config)
    ? (localization.localeCodes ?? localization.locales.map(entry => typeof entry === 'string' ? entry : entry.code)).map(locale => ({ locale, fallbackLocale: sanitizeFallbackLocale({ fallbackLocale: null, locale, localization }) }))
    : [{ locale: '', fallbackLocale: false }]
}
/** Canonical views of registered content, without multiplying nonlocalized rows. */
export function placementLocaleViews(req: PayloadRequest, collection: string): PlacementLocaleView[] {
  const localization = req.payload.config.localization
  const config = req.payload.config.collections?.find(entry => entry.slug === collection)
  const options = (req.payload.config.custom?.xp ?? {}) as ResolvedOptions
  const names = new Set([...puckCollections(options).filter(entry => entry.slug === collection).map(entry => entry.field),
    ...(options.blocks?.collections ?? []).filter(entry => entry.slug === collection).map(entry => entry.field)])
  const localized = config && hasLocalizedFields(config.fields ?? [], req.payload.config) && (Boolean(options.blocks?.collections.some(entry => entry.slug === collection && entry.appliesTo)) || flattenTopLevelFields(config.fields ?? []).some(field => 'name' in field && names.has(field.name!) && ('localized' in field && field.localized || 'fields' in field && hasLocalizedFields(field.fields, req.payload.config) || field.type === 'blocks' && hasLocalizedFields(contentBlocks(field, req.payload.config.blocks).flatMap(block => block.fields), req.payload.config))))
  return localization && localized
    ? (localization.localeCodes ?? localization.locales.map(entry => typeof entry === 'string' ? entry : entry.code)).map(locale => ({ locale, fallbackLocale: sanitizeFallbackLocale({ fallbackLocale: null, locale, localization }) }))
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
  const reader = placementReader(req, collection)
  const rawAfter = mergedPlacementLocales(req, collection, before, after)
  for (const view of reader.views) {
    const previous = reader.read(before, 'all-locales', view).slugs
    const next = removingPage ? [] : reader.read(rawAfter, 'all-locales', view).slugs
    for (const slug of previous.filter(slug => !next.includes(slug))) result.set(slug, [...(result.get(slug) ?? []), view])
  }
  return result
}

/** Rebuild unchanged locale maps around a flattened hook write before reading each view. */
export function mergedPlacementLocales(req: PayloadRequest, collection: string, before: Record<string, unknown> | undefined,
  after: Record<string, unknown>): Record<string, unknown> {
  const localization = req.payload.config.localization
  if (!localization || req.locale === 'all') return after
  return localeTransform(req, collection, req.locale || localization.defaultLocale, false)(after, true, before)
}
