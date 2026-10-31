import type { ExperimentsServerRuntime } from '../types/runtime.js'
import { XpNotImplemented } from '../errors.js'

export async function linkIdentity<TUser extends { id: string | number } = { id: string | number }>(_serverRuntime: ExperimentsServerRuntime<TUser>, _opts: { headers: Headers; userId: string }): Promise<void> {
  throw new XpNotImplemented('CORE-08a')
}
