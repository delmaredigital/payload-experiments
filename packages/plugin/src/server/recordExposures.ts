import type { ExperimentsServerRuntime } from '../types/runtime.js'
import type { Assignments, RenderedExposure } from '../types/assignments.js'
import { XpNotImplemented } from '../errors.js'

export async function recordExposures<TUser extends { id: string | number } = { id: string | number }>(_serverRuntime: ExperimentsServerRuntime<TUser>, _rendered: RenderedExposure[], _ctx: Assignments): Promise<void> {
  throw new XpNotImplemented('CORE-08a')
}
