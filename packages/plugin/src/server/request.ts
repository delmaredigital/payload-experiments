import { NextRequest } from 'next/server.js'
import { XP_REQUEST_HEADER } from '../constants.js'
import { verify } from '../runtime/signing.js'

/** Only proxy-signed context can supply a URL, method or consent decision. */
export function serverRequest(headers: Headers, secrets: readonly string[]): { request: NextRequest; hasContext: boolean; consent?: boolean } {
  const fallback = () => ({ request: new NextRequest('https://xp.invalid/', { headers, method: 'UNKNOWN' }), hasContext: false })
  const value = headers.get(XP_REQUEST_HEADER)
  if (!value || Buffer.byteLength(value) > 2048) return fallback()
  const parts = /^([^|]*)\|(.+)\|(c[01])\|([A-Za-z0-9_-]{43})$/.exec(value)
  if (!parts) return fallback()
  const verb = parts[1]!, path = parts[2]!, consent = parts[3]!, mac = parts[4]!
  if (!verify(`xp:request:${verb}|${path}|${consent}`, mac, secrets) || !path.startsWith('/') || /[\\\r\n#]/.test(path)) return fallback()
  const method = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(verb) ? verb : 'UNKNOWN'
  try {
    return { request: new NextRequest(`https://xp.invalid${path}`, { headers, method }), hasContext: true, consent: consent === 'c1' }
  } catch { return fallback() }
}
