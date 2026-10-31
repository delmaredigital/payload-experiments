import { NextRequest } from 'next/server.js'

/** Browser beacons carry their page URL in Referer. It supplies targeting context only. */
export function sourceRequest(request: NextRequest): NextRequest | null {
  const referrer = request.headers.get('referer')
  if (!referrer) return null
  try {
    const url = new URL(referrer)
    if (url.origin !== request.nextUrl.origin) return null
    return new NextRequest(url, { headers: request.headers })
  } catch { return null }
}
