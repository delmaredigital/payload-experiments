import type { Metadata } from 'next'
import type { ExperimentsServerRuntime } from '../types/runtime.js'
import { XpNotImplemented } from '../errors.js'

export async function experimentMetadata<TUser extends { id: string | number } = { id: string | number }>(_serverRuntime: ExperimentsServerRuntime<TUser>, _path: string): Promise<Pick<Metadata, 'robots' | 'alternates'>> {
  throw new XpNotImplemented('CORE-07')
}
