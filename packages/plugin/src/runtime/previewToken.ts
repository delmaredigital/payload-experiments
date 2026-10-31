import type { DocId } from '../types/contracts.js'
import { sign, verify } from './signing.js'

export interface PreviewToken { e: DocId; a: string; p: number; exp: number }

function validToken(value: unknown, now: number): value is PreviewToken {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const token = value as Record<string, unknown>
  return Object.keys(token).sort().join(',') === 'a,e,exp,p'
    && ((typeof token.e === 'string' && token.e.length > 0) || (typeof token.e === 'number' && Number.isSafeInteger(token.e)))
    && typeof token.a === 'string' && /^(control|variantA|variantB|variantC|holdout)$/.test(token.a)
    && typeof token.p === 'number' && Number.isSafeInteger(token.p) && token.p >= 0
    && typeof token.exp === 'number' && Number.isSafeInteger(token.exp) && token.exp > now && token.exp <= now + 3600
}

export function signPreviewToken(token: PreviewToken, secrets: readonly string[], now = Math.floor(Date.now() / 1000)): string {
  if (!validToken(token, now)) throw new Error('Invalid preview token or expiry')
  const value = Buffer.from(JSON.stringify(token)).toString('base64url')
  return `${value}.${sign(value, secrets)}`
}

export function verifyPreviewToken(value: string, secrets: readonly string[], now = Math.floor(Date.now() / 1000)): PreviewToken | null {
  try {
    const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(value)
    if (!match || !verify(match[1]!, match[2]!, secrets)) return null
    const bytes = Buffer.from(match[1]!, 'base64url')
    if (bytes.toString('base64url') !== match[1]) return null
    const token: unknown = JSON.parse(bytes.toString('utf8'))
    return validToken(token, now) ? token : null
  } catch {
    return null
  }
}
