import type { Manifest } from '../types/manifest.js'
import { XpNotImplemented } from '../errors.js'

export function experimentSitemapFilter(_path: string, _manifest: Manifest): boolean {
  throw new XpNotImplemented('CORE-07')
}
