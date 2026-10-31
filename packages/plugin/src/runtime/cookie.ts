import { XpNotImplemented } from '../errors.js'
export function verifyUnitCookie(_cookie: string | undefined, _secrets: string[]): string | null {
  throw new XpNotImplemented('CORE-04')
}
