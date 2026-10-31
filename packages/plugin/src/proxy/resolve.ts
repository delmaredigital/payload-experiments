import type { NextRequest, NextResponse } from 'next/server'
import type { ExperimentsProxyRuntime } from '../types/runtime.js'
import { XpNotImplemented } from '../errors.js'

export interface ExperimentsProxyResult {
  responseHeaders?: Headers
  requestHeaders: Headers
  requestCookies: Array<{ name: string; value: string }>
  setCookies: Array<Exclude<Parameters<NextResponse['cookies']['set']>[0], string>>
  rewrite?: URL
}

export async function resolveExperiments(_request: NextRequest, _proxyRuntime: ExperimentsProxyRuntime): Promise<ExperimentsProxyResult> {
  throw new XpNotImplemented('CORE-06')
}
