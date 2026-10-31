// Schema-only copy from main d292db4e74d036d15d012ce1b5892dc4ad1f5ba6; only external import paths adjusted.
import type { CollectionBeforeChangeHook } from 'payload'
import type { Arm } from '../../../../../src/types/contracts.js'
import type { FlagDefault } from '../../../../../src/types/manifest.js'
import { xpOptionsFromReq } from '../../options/fromReq.js'

export const flagControlParams: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req }) => {
  const kind = data.kind ?? originalDoc?.kind
  const status = operation === 'create' ? 'draft' : originalDoc?.status
  if (kind !== 'flag' || (status !== 'draft' && status !== 'stopped')) return data
  const pointId = data.flagPoint ?? originalDoc?.flagPoint
  const point = xpOptionsFromReq(req).flagPoints?.find(point => point.id === pointId)
  if (!point) return data
  let params = point.defaultParams
  try {
    const state = await req.payload.findGlobal({ slug: 'xp-state', req, overrideAccess: false })
    const defaults = state.flagDefaults as Record<string, FlagDefault> | undefined
    params = defaults?.[point.id]?.params ?? params
  } catch (cause) {
    const error = cause as { status?: unknown; name?: unknown } | null | undefined
    if (error?.status !== 403 && error?.name !== 'Forbidden') throw cause
    // A refused state read must not prevent using the registered point defaults.
  }
  const arms: Arm[] | undefined = data.arms ?? originalDoc?.arms
  if (!arms) return data
  return { ...data, arms: arms.map(arm => arm.kind === 'control' ? { ...arm, params } : arm) }
}
