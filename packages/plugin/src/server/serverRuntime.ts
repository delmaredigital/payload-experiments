import type { ExperimentsProxyRuntime, ExperimentsServerRuntime, ExperimentsServerRuntimeOptions } from '../types/runtime.js'
export function defineExperimentsServerRuntime<TUser extends { id: string | number } = { id: string | number }>(proxyRuntime: ExperimentsProxyRuntime, opts: ExperimentsServerRuntimeOptions<TUser>): ExperimentsServerRuntime<TUser> {
  return { proxyRuntime, getPayload: opts.getPayload, getUser: opts.getUser, userIdOf: opts.userIdOf ?? (u => String(u.id)), attributesOf: opts.attributesOf ?? (u => ({ loggedIn: Boolean(u) })) }
}
