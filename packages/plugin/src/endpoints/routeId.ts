import type { PayloadRequest } from 'payload'
import type { DocId } from '../types/contracts.js'

/** Match Payload's relationship ID type before passing an HTTP ID to Local API or SQL. */
export function experimentId(req: PayloadRequest, value: unknown): DocId | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const id = String(value)
  const idType = req.payload.collections?.['xp-experiments']?.customIDType ?? req.payload.db.defaultIDType
  if (idType !== 'number') return id
  if (!/^\d+$/.test(id)) return undefined
  const number = Number(id)
  // Payload's Postgres serial ids are int4; larger values would reach SQL and fail with 22003.
  return Number.isSafeInteger(number) && number <= 2_147_483_647 ? number : undefined
}

export function routeId(req: PayloadRequest): DocId | undefined {
  return experimentId(req, req.routeParams?.id)
}
