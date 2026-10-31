import type { NextRequest, NextResponse } from 'next/server'
import type { ExperimentsProxyRuntime } from '../types/runtime.js'
import { XpNotImplemented } from '../errors.js'

export function createExperimentProxy(_proxyRuntime: ExperimentsProxyRuntime): (request: NextRequest) => Promise<NextResponse> {
  throw new XpNotImplemented('CORE-06')
}
