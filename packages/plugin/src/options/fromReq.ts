import type { PayloadRequest } from 'payload'
import type { ResolvedOptions } from '../types/contracts.js'

export function xpOptionsFromReq(req: PayloadRequest): ResolvedOptions {
  const options = req.payload.config.custom?.xp as ResolvedOptions | undefined
  if (!options) throw new Error('Experiments options are missing from req.payload.config.custom.xp; install the experiments plugin first.')
  return options
}
