'use client'

import { conversionApiRoute, sendEvent } from './beacon.js'
import { idempotencyKey } from './idempotency.js'

export function trackConversionBeacon(eventName: string, opts?: { idempotencyKey?: string }): void {
  sendEvent(conversionApiRoute(), { type: 'conversion', eventName, idempotencyKey: idempotencyKey(opts?.idempotencyKey) })
}
