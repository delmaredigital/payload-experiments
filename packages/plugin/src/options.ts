import { validateAccent } from './ui/accent.js'
import { DEFAULT_MAX_BODY_BYTES } from './constants.js'
import type { ExperimentsPluginOptions, ResolvedOptions } from './types/contracts.js'

const normalisedCollections = new WeakMap<NonNullable<ExperimentsPluginOptions['puck']>['collections'], Array<{ slug: string; field: string }>>()

/** Resolve once per registration list; every consumer shares the same field defaults. */
export function puckCollections(options: Pick<ExperimentsPluginOptions, 'puck'>): Array<{ slug: string; field: string }> {
  const entries = options.puck?.collections
  if (!entries) return []
  const cached = normalisedCollections.get(entries)
  if (cached) return cached
  const resolved = entries.map(entry => typeof entry === 'string' ? { slug: entry, field: 'puckData' } : { slug: entry.slug, field: entry.field ?? 'puckData' })
  normalisedCollections.set(entries, resolved)
  normalisedCollections.set(resolved, resolved)
  return resolved
}

export function resolveOptions<TUser extends { id: string | number }>(input: ExperimentsPluginOptions<TUser>): ResolvedOptions<TUser> {
  if (typeof input?.access?.manage !== 'function') throw new Error('Experiments access.manage must be a function')
  const { manage, admin = manage, readResults = manage, readIdentities = admin } = input.access
  for (const [name, access] of Object.entries({ admin, readResults, readIdentities })) {
    if (typeof access !== 'function') throw new Error(`Experiments access.${name} must be a function`)
  }

  if (input.admin !== undefined) {
    const admin = input.admin
    if (!admin || typeof admin !== 'object' || Array.isArray(admin)) throw new Error('Experiments admin must be an object')
    for (const key of Object.keys(admin)) {
      if (!['editorUrl', 'previewUrl', 'descriptions'].includes(key)) throw new Error(`Unknown experiments admin option: ${key}`)
    }
    for (const key of ['editorUrl', 'previewUrl'] as const) {
      if (admin[key] !== undefined && typeof admin[key] !== 'function') throw new Error(`Experiments admin.${key} must be a function`)
    }
    if (admin.descriptions !== undefined) {
      if (!admin.descriptions || typeof admin.descriptions !== 'object' || Array.isArray(admin.descriptions)) throw new Error('Experiments admin.descriptions must be an object')
      for (const [key, value] of Object.entries(admin.descriptions)) {
        if (!['block', 'document', 'setting', 'page'].includes(key)) throw new Error(`Unknown experiments admin.descriptions option: ${key}`)
        if (value !== undefined && typeof value !== 'string') throw new Error(`Experiments admin.descriptions.${key} must be a string`)
      }
    }
  }
  if (input.pages !== undefined) {
    if (!input.pages || !Array.isArray(input.pages.collections) || input.pages.collections.length === 0) throw new Error('Experiments pages.collections must be a non-empty array')
    const slugs = new Set<string>()
    for (const entry of input.pages.collections) {
      if (!entry || typeof entry.slug !== 'string' || !entry.slug.trim() || slugs.has(entry.slug) || typeof entry.pathOf !== 'function' || typeof entry.findByPath !== 'function') {
        throw new Error('Experiments pages.collections requires unique slugs, pathOf and findByPath functions')
      }
      if (entry.contentOf !== undefined && typeof entry.contentOf !== 'function') throw new Error('Experiments contentOf must be a function')
      for (const [key, max] of [['copyHint', 200], ['copyLabel', 40]] as const) {
        const value = entry[key]
        if (value !== undefined && (typeof value !== 'string' || !value.trim() || value.length > max)) throw new Error(`Experiments ${key} must be a non-empty string of at most ${max} characters`)
      }
      if (entry.copyUrl !== undefined && !validCopyUrl(entry.copyUrl)) throw new Error('Experiments copyUrl must be a root-relative path')
      if (entry.copyLabel !== undefined && entry.copyUrl === undefined) throw new Error('Experiments copyLabel requires copyUrl')
      slugs.add(entry.slug)
    }
  }
  if (input.blocks !== undefined) {
    if (!input.blocks || !Array.isArray(input.blocks.collections) || !input.blocks.collections.length) throw new Error('Experiments blocks.collections must be a non-empty array')
    const slugs = new Set<string>()
    for (const entry of input.blocks.collections) {
      if (!entry || typeof entry.slug !== 'string' || !entry.slug.trim() || slugs.has(entry.slug) || typeof entry.field !== 'string' || !entry.field.trim()
        || entry.blockSlug !== undefined && (typeof entry.blockSlug !== 'string' || !entry.blockSlug.trim())
        || entry.appliesTo !== undefined && typeof entry.appliesTo !== 'function') throw new Error('Invalid experiments blocks collection')
      if (puckCollections(input).some(puck => puck.slug === entry.slug) && !entry.appliesTo) throw new Error('A collection registered in puck and blocks requires appliesTo')
      slugs.add(entry.slug)
    }
  }
  if (input.theme !== undefined) {
    if (!input.theme || typeof input.theme !== 'object' || Array.isArray(input.theme)) throw new Error('Experiments theme must be an object')
    for (const key of Object.keys(input.theme)) if (key !== 'accent') throw new Error(`Unknown experiments theme option: ${key}`)
    validateAccent(input.theme.accent)
  }
  const ids = new Set<string>()
  for (const point of input.flagPoints ?? []) {
    if (typeof point.id !== 'string' || !point.id || ids.has(point.id)) throw new Error('Experiments flag point ids must be unique nonempty strings')
    if (point.description !== undefined && typeof point.description !== 'string') throw new Error('Experiments flag point description must be a string')
    ids.add(point.id)
  }
  // Record keys are unique by construction; validate each declared key and type.
  for (const [key, attribute] of Object.entries(input.attributeKeys ?? {})) {
    if (!key || !attribute || !['string', 'number', 'boolean'].includes(attribute.type)) throw new Error(`Invalid experiments attribute key or type: ${key}`)
    if (attribute.values !== undefined && (!Array.isArray(attribute.values) || attribute.values.some(value => typeof value !== 'string'))) {
      throw new Error(`Experiments attribute values must be strings: ${key}`)
    }
  }
  const eventNames = new Set<string>()
  const eventSources = (input.eventSources ?? []).map(entry => {
    const object = entry !== null && typeof entry === 'object' && !Array.isArray(entry)
    const name = typeof entry === 'string' ? entry : object ? entry.name : undefined
    if (typeof name !== 'string' || !/^[a-z0-9_]+$/.test(name)) throw new Error('Experiments event source names must match /^[a-z0-9_]+$/')
    if (object && typeof entry.clientWritable !== 'boolean') throw new Error('Experiments event source clientWritable must be a boolean')
    if (eventNames.has(name)) throw new Error('Experiments event source names must be unique')
    eventNames.add(name)
    return { name, clientWritable: typeof entry === 'string' ? true : entry.clientWritable }
  })
  const retentionDays = input.events?.retentionDays ?? 180
  const maxBodyBytes = input.events?.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  for (const [name, value] of Object.entries({ retentionDays, maxBodyBytes })) {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) throw new Error(`Experiments events.${name} must be a finite positive integer`)
  }
  const dimensions = input.events?.dimensions === undefined ? [] : input.events.dimensions
  return {
    ...input,
    access: { manage, admin, readResults, readIdentities },
    flagPoints: [...(input.flagPoints ?? [])], metricSources: [...(input.metricSources ?? [])], eventSources,
    attributeKeys: Object.fromEntries(Object.entries(input.attributeKeys ?? {}).map(([key, attribute]) => [key, { ...attribute, ...(attribute.values ? { values: [...attribute.values] } : {}) }])),
    events: { ...input.events, retentionDays, maxBodyBytes, dimensions: Array.isArray(dimensions) ? [...dimensions] : dimensions },
    puck: { ...input.puck, enabled: input.puck?.enabled ?? Boolean(input.puck?.collections?.length), collections: puckCollections(input) },
  }
}

function validCopyUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\/(?![/\\])/.test(value) || /[\s\x00-\x1f\x7f]/.test(value)) return false
  try { return new URL(value, 'http://x').origin === 'http://x' } catch { return false }
}

/** One published-row rule shared by scans, bindings, writes and editor links. */
export function documentEditor(options: Pick<ExperimentsPluginOptions, 'puck' | 'blocks'>, collection: string, doc: Record<string, unknown>): 'puck' | 'blocks' | 'page' {
  const block = options.blocks?.collections.find(entry => entry.slug === collection)
  const puck = options.puck?.enabled !== false && puckCollections(options).some(entry => entry.slug === collection)
  if (block && (block.appliesTo ? block.appliesTo(doc) : true)) return 'blocks'
  return puck ? 'puck' : 'page'
}
