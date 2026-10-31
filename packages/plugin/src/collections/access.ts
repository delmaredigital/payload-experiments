import type { Access } from 'payload'
import type { ExperimentsAccess, ResolvedOptions } from '../types/contracts.js'

/** Host access callbacks must return the boolean true, never a truthy filter. */
export const isTrue = (fn: ExperimentsAccess): Access => async ({ req }) => (await fn({ req })) === true
export const deny: Access = () => false

export function managedAccess(options: ResolvedOptions) {
  const manage = isTrue(options.access.manage)
  return { create: manage, read: manage, update: manage, delete: manage, readVersions: manage, unlock: manage }
}

export function readOnlyAccess(read: ExperimentsAccess) {
  return { create: deny, read: isTrue(read), update: deny, delete: deny, readVersions: deny, unlock: deny }
}
