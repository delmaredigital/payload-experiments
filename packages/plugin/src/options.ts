import { contrast, deriveAccent } from './ui/accent.js'
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
        if (!['block', 'document', 'setting'].includes(key)) throw new Error(`Unknown experiments admin.descriptions option: ${key}`)
        if (value !== undefined && typeof value !== 'string') throw new Error(`Experiments admin.descriptions.${key} must be a string`)
      }
    }
  }
  if (input.pages !== undefined) {
    if (!input.pages || !Array.isArray(input.pages.collections)) throw new Error('Experiments pages.collections must be an array')
    const slugs = new Set<string>()
    for (const entry of input.pages.collections) {
      if (!entry || typeof entry.slug !== 'string' || !entry.slug.trim() || slugs.has(entry.slug) || typeof entry.pathOf !== 'function' || typeof entry.findByPath !== 'function') {
        throw new Error('Experiments pages.collections requires unique slugs, pathOf and findByPath functions')
      }
      slugs.add(entry.slug)
    }
  }
  if (input.theme !== undefined) {
    if (!input.theme || typeof input.theme !== 'object' || Array.isArray(input.theme)) throw new Error('Experiments theme must be an object')
    for (const key of Object.keys(input.theme)) if (key !== 'accent') throw new Error(`Unknown experiments theme option: ${key}`)
    const accent = input.theme.accent
    if (accent !== undefined && accent !== '') {
      if (typeof accent !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(accent)) throw new Error('Experiments theme.accent must be a CSS hex colour (#rgb or #rrggbb)')
      for (const [mode, set] of Object.entries(deriveAccent(accent))) {
        const ratio = contrast(set.accent, set.fg)
        if (ratio < 4.5) throw new Error(`Experiments theme.accent ${accent}: ${mode} foreground contrast ${ratio.toFixed(2)}:1 is below 4.5:1`)
      }
    }
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
