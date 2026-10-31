import type { ExperimentsProxyRuntime, ExperimentsServerRuntime, ExperimentsServerRuntimeOptions } from '../types/runtime.js'
export function defineExperimentsServerRuntime(proxyRuntime: ExperimentsProxyRuntime, opts: ExperimentsServerRuntimeOptions): ExperimentsServerRuntime {
  return { proxyRuntime, getPayload: opts.getPayload, getUser: opts.getUser, userIdOf: opts.userIdOf ?? (u => String(u.id)), attributesOf: opts.attributesOf ?? (u => ({ loggedIn: Boolean(u) })) }
}
