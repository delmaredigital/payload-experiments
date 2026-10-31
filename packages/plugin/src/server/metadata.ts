import type { Metadata } from 'next'
import { XpNotImplemented } from '../errors.js'

export async function experimentMetadata(_path: string): Promise<Metadata> {
  throw new XpNotImplemented('CORE-07')
}
