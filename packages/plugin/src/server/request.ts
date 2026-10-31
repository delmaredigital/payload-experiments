import { NextRequest } from 'next/server'

/** CORE-06c supplies verified request context. Until then, no header is a URL or method source. */
export function serverRequest(headers: Headers): { request: NextRequest; hasContext: boolean } {
  return { request: new NextRequest('https://xp.invalid/', { headers, method: 'UNKNOWN' }), hasContext: false }
}
