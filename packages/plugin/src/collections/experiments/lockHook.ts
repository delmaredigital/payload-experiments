import type { CollectionBeforeChangeHook } from 'payload'
import type { EditableField } from '../../types/admin.js'
import type { Status } from '../../types/contracts.js'
import { XpLockedFieldError } from '../../errors.js'
import { xpOptionsFromReq } from '../../options/fromReq.js'
import { EDITABLE_BY_STATUS } from './editability.js'
import { defaultArms } from './armInvariants.js'

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
const relationships = new Set(['layer', 'metrics.primary', 'metrics.secondary', 'metrics.guardrails', 'decision.decidedBy', 'decision.snapshotId'])
const dates = new Set(['startedAt', 'stoppedAt', 'decidedAt', 'archivedAt', 'decision.discardedAt'])

/** Schema-aware: JSON retains its own ids and date-like strings. */
function normalize(value: unknown, path: string, json = false): unknown {
  json ||= ['arms.params', 'targeting.value', 'decision.contentReport'].includes(path)
  if (value === undefined || (value === null && !json)) return undefined
  if (value === null) return null
  if (!json && relationships.has(path)) {
    if (Array.isArray(value)) return value.length ? value.map(item => normalize(item, path)) : undefined
    if (isObject(value) && 'id' in value) return value.id == null ? undefined : String(value.id)
    if (typeof value === 'string' || typeof value === 'number') return String(value)
  }
  if (!json && (value instanceof Date || dates.has(path))) {
    const date = new Date(value as string | Date)
    if (!Number.isNaN(date.valueOf())) return date.toISOString()
  }
  if (Array.isArray(value)) return value.map(item => {
    if (!json && ['arms', 'targeting'].includes(path) && isObject(item)) {
      const { id: _rowId, ...row } = item
      return normalize(row, path)
    }
    return normalize(item, path, json)
  })
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().flatMap(key => {
    const nested = normalize(value[key], `${path}.${key}`, json)
    return nested === undefined ? [] : [[key, nested]]
  }))
  return value
}

const same = (a: unknown, b: unknown, path: string) => JSON.stringify(normalize(a, path)) === JSON.stringify(normalize(b, path))

export const lockHook: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req }) => {
  if (req.context.xpTransition === true) return data
  const admin = async () => {
    const options = xpOptionsFromReq(req)
    return await (options.access.admin ?? options.access.manage)({ req }) === true
  }
  if (operation === 'create') {
    const result: Record<string, unknown> = { ...data, status: 'draft', phase: 0 }
    // Timestamps are Payload's: a client-sent value is never stored.
    delete result.createdAt
    delete result.updatedAt
    for (const field of ['seed', 'layerSlices', 'startedAt', 'stoppedAt', 'decidedAt', 'archivedAt', 'decision']) result[field] = undefined
    if (!data.arms || (Array.isArray(data.arms) && data.arms.length === 0)) {
      result.arms = defaultArms(data.kind)
    }
    if (data.kind === 'code' && !await admin()) throw new XpLockedFieldError('kind', 'draft')
    if (data.analysis?.method != null && data.analysis.method !== 'sequential' && !await admin()) throw new XpLockedFieldError('analysis.method', 'draft')
    return result
  }
  const status = originalDoc.status as Status
  const editable = EDITABLE_BY_STATUS[status] ?? []
  const check = async (field: string, value: unknown, before: unknown) => {
    if (same(value, before, field)) return
    if (!editable.includes(field.split('.')[0] as EditableField)) throw new XpLockedFieldError(field, status)
    if (field === 'analysis.method' && !await admin()) throw new XpLockedFieldError(field, status)
    if (field === 'arms' && status !== 'draft') {
      if (Array.isArray(value) && Array.isArray(before)) {
        const byId = new Map(before.filter(arm => arm.id != null).map(arm => [String(arm.id), arm]))
        const changedKey = value.some((arm, index) => {
          // An unmatched id is a new row; without ids, position identifies an existing row.
          const previous = arm.id != null && byId.size > 0 ? byId.get(String(arm.id)) : before[index]
          return previous !== undefined && arm.key !== previous.key
        })
        if (changedKey) throw new XpLockedFieldError('arms.key', status)
      }
    }
  }
  // Payload owns the timestamps. It rewrites `updatedAt` on every save, but stores a
  // client-sent `createdAt` as given, so pin it to the stored value (a Restore's
  // version carries the same value, so Restores are unaffected).
  if ('createdAt' in data) data.createdAt = originalDoc.createdAt
  for (const [field, value] of Object.entries(data)) {
    if (field === 'updatedAt' || field === 'createdAt') continue
    if (['analysis', 'metrics', 'decision'].includes(field) && isObject(value)) {
      for (const [key, nested] of Object.entries(value)) await check(`${field}.${key}`, nested, originalDoc[field]?.[key])
    } else {
      await check(field, value, originalDoc[field])
      // Replacing the group also changes its method, including clearing it.
      if (field === 'analysis' && !same(value, originalDoc.analysis, field) && originalDoc.analysis?.method != null && !await admin()) throw new XpLockedFieldError('analysis.method', status)
    }
  }
  return data
}
