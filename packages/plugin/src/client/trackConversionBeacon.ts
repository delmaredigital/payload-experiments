'use client'

import { conversionApiRoute, sendEvent, warnOnce } from './beacon.js'
import { idempotencyKey } from './idempotency.js'

export function trackConversionBeacon(eventName: string, opts?: { idempotencyKey?: string }): void {
  const apiRoute = conversionApiRoute()
  if (apiRoute === undefined) {
    // Without an ExperimentsProvider the host has experiments disabled here; never send to a guessed route.
    if (process.env.NODE_ENV !== 'production') warnOnce('conversion:no-provider', `trackConversionBeacon('${eventName}') was called without an ExperimentsProvider; nothing was sent.`)
    return
  }
  sendEvent(apiRoute, { type: 'conversion', eventName, idempotencyKey: idempotencyKey(opts?.idempotencyKey) })
}
