import { randomBytes } from 'node:crypto'
import type { ExperimentsProxyRuntime } from '../types/runtime.js'
import { sign, verify } from './signing.js'

export function mintUnitId(): string {
  return randomBytes(16).toString('base64url')
}

export function encodeUnitCookie(unitId: string, secrets: readonly string[]): string {
  if (!/^[A-Za-z0-9_-]+$/.test(unitId)) throw new Error('Invalid unit id')
  return `${unitId}.${sign(unitId, secrets)}`
}

export function verifyUnitCookie(cookie: string | undefined, secrets: readonly string[]): string | null {
  if (typeof cookie !== 'string') return null
  const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(cookie)
  return match && verify(match[1]!, match[2]!, secrets) ? match[1]! : null
}

export function cookieAttributes(runtime: Pick<ExperimentsProxyRuntime, 'cookie'>, { https }: { https: boolean }) {
  return {
    httpOnly: true, sameSite: 'lax' as const, path: '/',
    maxAge: runtime.cookie.maxAgeDays * 86400,
    ...(https ? { secure: true } : {}),
    ...(runtime.cookie.domain ? { domain: runtime.cookie.domain } : {}),
  }
}
