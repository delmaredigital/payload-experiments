import { NextResponse, type NextRequest } from 'next/server'
import type { ExperimentsProxyRuntime } from '../types/runtime.js'
import { resolveExperiments } from './resolve.js'
import { applyExperiments } from './apply.js'

export function createExperimentProxy(proxyRuntime: ExperimentsProxyRuntime): (request: NextRequest) => Promise<NextResponse> {
  return async request => {
    const result = await resolveExperiments(request, proxyRuntime)
    const options = { request: { headers: result.requestHeaders } }
    const response = result.rewrite ? NextResponse.rewrite(result.rewrite, options) : NextResponse.next(options)
    return applyExperiments(response, result)
  }
}
