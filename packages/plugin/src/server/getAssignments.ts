import type { ExperimentsServerRuntime } from '../types/runtime.js'
import type { Assignments } from '../types/assignments.js'
import { XpNotImplemented } from '../errors.js'

export async function getAssignments<TUser extends { id: string | number } = { id: string | number }>(_serverRuntime: ExperimentsServerRuntime<TUser>, _opts?: { user?: TUser | null }): Promise<Assignments> {
  throw new XpNotImplemented('CORE-07')
}
