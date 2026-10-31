import type { ExperimentsServerRuntime } from '../types/runtime.js'
import type { FlagPointResult } from '../types/assignments.js'
import { XpNotImplemented } from '../errors.js'

export async function getFlagPoint<TUser extends { id: string | number } = { id: string | number }>(_serverRuntime: ExperimentsServerRuntime<TUser>, _id: string, _opts?: { user?: TUser | null }): Promise<FlagPointResult & { expose(renderedArm: string): Promise<void> }> {
  throw new XpNotImplemented('CORE-07')
}
