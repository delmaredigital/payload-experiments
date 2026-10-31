import { randomBytes } from 'node:crypto'
import { NextRequest } from 'next/server.js'
import type { ExperimentsProxyRuntime } from '../types/runtime.js'
import { sign, verify } from './signing.js'

export function mintUnitId(): string {
  return randomBytes(16).toString('base64url')
}

export function encodeUnitCookie(unitId: string, secrets: readonly string[]): string {
  if (!/^[A-Za-z0-9_-]+$/.test(unitId)) throw new Error('Invalid unit id')
  return `${unitId}.${sign(`xp:unit:${unitId}`, secrets)}`
}

export function verifyUnitCookie(cookie: string | undefined, secrets: readonly string[]): string | null {
  if (typeof cookie !== 'string') return null
  const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(cookie)
  return match && verify(`xp:unit:${match[1]!}`, match[2]!, secrets) ? match[1]! : null
}

/** Use Next's cookie selection everywhere: the last cookie of a given name wins. */
export function readUnitCookie(input: Headers | NextRequest, runtime: Pick<ExperimentsProxyRuntime, 'cookie' | 'secrets'>): string | null {
  const request = input instanceof Headers ? new NextRequest('https://xp.invalid/', { headers: input }) : input
  return verifyUnitCookie(request.cookies.get(runtime.cookie.name)?.value, runtime.secrets)
}

export function cookieAttributes(runtime: Pick<ExperimentsProxyRuntime, 'cookie'>, { https }: { https: boolean }) {
  return {
    httpOnly: true, sameSite: 'lax' as const, path: '/',
    maxAge: runtime.cookie.maxAgeDays * 86400,
    ...(https ? { secure: true } : {}),
    ...(runtime.cookie.domain ? { domain: runtime.cookie.domain } : {}),
  }
}
