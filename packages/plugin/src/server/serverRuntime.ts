import type { ExperimentsProxyRuntime, ExperimentsServerRuntime, ExperimentsServerRuntimeOptions } from '../types/runtime.js'

const hostAttributesOf = Symbol('hostAttributesOf')

export function hasHostAttributesOf(runtime: object): boolean {
  return Object.getOwnPropertyDescriptor(runtime, hostAttributesOf)?.value === true
}

export function defineExperimentsServerRuntime<TUser extends { id: string | number } = { id: string | number }>(proxyRuntime: ExperimentsProxyRuntime, opts: ExperimentsServerRuntimeOptions<TUser>): ExperimentsServerRuntime<TUser> {
  const runtime: ExperimentsServerRuntime<TUser> = { proxyRuntime, getPayload: opts.getPayload, getUser: opts.getUser, userIdOf: opts.userIdOf ?? (u => String(u.id)), attributesOf: opts.attributesOf ?? (u => ({ loggedIn: Boolean(u) })) }
  if (typeof opts.attributesOf === 'function') Object.defineProperty(runtime, hostAttributesOf, { value: true, enumerable: false })
  return runtime
}
