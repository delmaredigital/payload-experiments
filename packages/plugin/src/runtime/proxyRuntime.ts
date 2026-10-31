import { XP_COOKIE } from '../constants.js'
import type { ExperimentsProxyRuntime, ExperimentsProxyRuntimeOptions } from '../types/runtime.js'
export function defineExperimentsProxyRuntime(opts: ExperimentsProxyRuntimeOptions): ExperimentsProxyRuntime {
  const secrets = typeof opts.secret === 'string' ? [opts.secret] : [...opts.secret]
  if (!secrets.length || secrets.some(secret => !secret.trim())) throw new Error('At least one non-empty secret is required')
  const cookie = Object.freeze({ ...opts.cookie, name: opts.cookie?.name ?? XP_COOKIE, maxAgeDays: opts.cookie?.maxAgeDays ?? 365 })
  Object.freeze(secrets)
  return Object.freeze({ secrets, apiRoute: opts.apiRoute, cookie, loadManifest: opts.loadManifest, getUnit: opts.getUnit })
}
