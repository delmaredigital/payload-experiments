import { DEFAULT_MAX_BODY_BYTES } from './constants.js'
import type { ExperimentsPluginOptions, ResolvedOptions } from './types/contracts.js'

export function resolveOptions<TUser extends { id: string | number }>(input: ExperimentsPluginOptions<TUser>): ResolvedOptions<TUser> {
  if (typeof input?.access?.manage !== 'function') throw new Error('Experiments access.manage must be a function')
  const { manage, admin = manage, readResults = manage, readIdentities = admin } = input.access
  for (const [name, access] of Object.entries({ admin, readResults, readIdentities })) {
    if (typeof access !== 'function') throw new Error(`Experiments access.${name} must be a function`)
  }

  const ids = new Set<string>()
  for (const point of input.flagPoints ?? []) {
    if (typeof point.id !== 'string' || !point.id || ids.has(point.id)) throw new Error('Experiments flag point ids must be unique nonempty strings')
    ids.add(point.id)
  }
  // Record keys are unique by construction; validate each declared key and type.
  for (const [key, attribute] of Object.entries(input.attributeKeys ?? {})) {
    if (!key || !attribute || !['string', 'number', 'boolean'].includes(attribute.type)) throw new Error(`Invalid experiments attribute key or type: ${key}`)
    if (attribute.values !== undefined && (!Array.isArray(attribute.values) || attribute.values.some(value => typeof value !== 'string'))) {
      throw new Error(`Experiments attribute values must be strings: ${key}`)
    }
  }
  for (const name of input.eventSources ?? []) {
    if (typeof name !== 'string' || !/^[a-z0-9_]+$/.test(name)) throw new Error('Experiments event source names must match /^[a-z0-9_]+$/')
  }
  return {
    ...input,
    access: { manage, admin, readResults, readIdentities },
    flagPoints: [...(input.flagPoints ?? [])], metricSources: [...(input.metricSources ?? [])], eventSources: [...(input.eventSources ?? [])],
    attributeKeys: Object.fromEntries(Object.entries(input.attributeKeys ?? {}).map(([key, attribute]) => [key, { ...attribute, ...(attribute.values ? { values: [...attribute.values] } : {}) }])),
    events: { ...input.events, retentionDays: input.events?.retentionDays ?? 180, maxBodyBytes: input.events?.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES },
    puck: { ...input.puck, enabled: input.puck?.enabled ?? false, collections: [...(input.puck?.collections ?? [])] },
  }
}
