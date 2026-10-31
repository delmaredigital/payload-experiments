// Schema-only copy from main d292db4e74d036d15d012ce1b5892dc4ad1f5ba6; only external import paths adjusted.
import type { PayloadRequest } from 'payload'
import type { ResolvedOptions } from '../../../../src/types/contracts.js'

export function xpOptionsFromReq(req: PayloadRequest): ResolvedOptions {
  const options = req.payload.config.custom?.xp as ResolvedOptions | undefined
  if (!options) throw new Error('Experiments options are missing from req.payload.config.custom.xp; install the experiments plugin first.')
  return options
}
