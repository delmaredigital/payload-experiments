import { NextRequest } from 'next/server'

/** Hosts may forward Next's invocation context or a full next-url/x-url. */
export function serverRequest(headers: Headers): { request: NextRequest; hasContext: boolean } {
  const path = headers.get('next-url') ?? headers.get('x-url') ?? headers.get('x-invoke-path') ?? '/'
  let url: URL
  let valid = true
  try { url = new URL(path, `${headers.get('x-forwarded-proto') === 'http' ? 'http' : 'https'}://${headers.get('host') ?? 'xp.invalid'}`) } catch { url = new URL('https://xp.invalid/'); valid = false }
  if (!url.search && headers.has('x-invoke-query')) {
    try {
      const query: unknown = JSON.parse(headers.get('x-invoke-query')!)
      if (query && typeof query === 'object') for (const [key, value] of Object.entries(query)) {
        if (typeof value === 'string') url.searchParams.set(key, value)
      }
    } catch { /* Malformed invocation metadata supplies no preview. */ }
  }
  const method = headers.get('x-invoke-method') ?? 'UNKNOWN'
  const hasContext = valid && ['next-url', 'x-url', 'x-invoke-path'].some(key => headers.has(key)) && method !== 'UNKNOWN' && /^[A-Z]+$/.test(method)
  return { request: new NextRequest(url, { headers, method: /^[A-Z]+$/.test(method) ? method : 'UNKNOWN' }), hasContext }
}
