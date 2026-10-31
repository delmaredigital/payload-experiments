import type { NextResponse } from 'next/server'
import type { ExperimentsProxyResult } from './resolve.js'

export function applyExperiments(response: NextResponse, result: ExperimentsProxyResult): NextResponse {
  for (const cookie of result.setCookies) response.cookies.set(cookie)
  result.responseHeaders?.forEach((value, name) => response.headers.set(name, value))
  return response
}
