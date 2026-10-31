import type { NextResponse } from 'next/server'
import type { ExperimentsProxyResult } from './resolve.js'
import { XpNotImplemented } from '../errors.js'

export function applyExperiments(_response: NextResponse, _result: ExperimentsProxyResult): NextResponse {
  throw new XpNotImplemented('CORE-06')
}
