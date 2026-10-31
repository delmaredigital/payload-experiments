import type { ExperimentsServerRuntime } from '../types/runtime.js'
import { XpNotImplemented } from '../errors.js'

export async function trackConversion<TUser extends { id: string | number } = { id: string | number }>(_serverRuntime: ExperimentsServerRuntime<TUser>, _event: { eventName: string; value?: number; idempotencyKey: string; userId?: string }): Promise<void> {
  throw new XpNotImplemented('CORE-08a')
}
