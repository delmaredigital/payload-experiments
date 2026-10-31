import type { Plugin } from 'payload'
import type { ExperimentsPluginOptions } from './types/contracts.js'
import { XpNotImplemented } from './errors.js'

export function createExperimentsPlugin<TUser extends { id: string | number } = { id: string | number }>(_options: ExperimentsPluginOptions<TUser>): Plugin {
  throw new XpNotImplemented('CORE-02c')
}
