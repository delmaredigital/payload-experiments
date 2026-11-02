import type { CollectionBeforeChangeHook } from 'payload'
import type { Arm } from '../../types/contracts.js'
import type { FlagDefault } from '../../types/manifest.js'
import { xpOptionsFromReq } from '../../options/fromReq.js'

export const flagControlParams: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req }) => {
  const kind = data.kind ?? originalDoc?.kind
  const status = operation === 'create' ? 'draft' : originalDoc?.status
  if (kind !== 'flag' || (status !== 'draft' && status !== 'stopped')) return data
  const pointId = data.flagPoint ?? originalDoc?.flagPoint
  const point = xpOptionsFromReq(req).flagPoints?.find(point => point.id === pointId)
  if (!point) return data
  // the caller's write already passed experiments manage access; a second gate inside its hook would kill the caller's transaction on Forbidden (Payload killTransaction)
  const state = await req.payload.findGlobal({ slug: 'xp-state', req, overrideAccess: true })
  const defaults = state.flagDefaults as Record<string, FlagDefault> | undefined
  const params = defaults?.[point.id]?.params ?? point.defaultParams
  const arms: Arm[] | undefined = data.arms ?? originalDoc?.arms
  if (!arms) return data
  return { ...data, arms: arms.map(arm => arm.kind === 'control' ? { ...arm, params } : arm) }
}
