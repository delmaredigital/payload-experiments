'use client'

import type { EventBody } from '../types/endpoints.js'

type Event = EventBody['events'][number]
type Exposure = Extract<Event, { type: 'exposure' }>
const exposures = new Set<string>()
const pageviews = new Set<string>()
const warnings = new Set<string>()
const providers = new Map<symbol, string>()

/** Register only committed providers; the latest mounted provider supplies conversion routing. */
export function registerApiRoute(token: symbol, apiRoute: string): void {
  // Updating an existing token preserves its original mount order.
  providers.set(token, apiRoute)
}

export function unregisterApiRoute(token: symbol): void {
  providers.delete(token)
}

export function conversionApiRoute(): string {
  return [...providers.values()].at(-1) ?? '/api'
}

export function warnOnce(key: string, message: string): void {
  if (warnings.has(key)) return
  warnings.add(key)
  console.error(message)
}

/** Telemetry must never interrupt rendering or a host interaction. */
export function sendEvent(apiRoute: string, event: Event): void {
  try {
    const body: EventBody = { events: [event] }
    const json = JSON.stringify(body)
    const url = `${apiRoute}/xp/events`
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' &&
        navigator.sendBeacon(url, new Blob([json], { type: 'text/plain;charset=UTF-8' }))) return
    } catch { /* A blocked beacon can still use the fetch fallback. */ }
    try {
      void fetch(url, {
        method: 'POST', keepalive: true, credentials: 'same-origin',
        headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: json,
      }).catch(() => {})
    } catch { /* Missing or blocked fetch is also non-fatal. */ }
  } catch { /* Serialization or browser API failures must not escape. */ }
}

export function sendExposure(apiRoute: string, event: Exposure, pathname?: string): void {
  const seen = pathname === undefined ? exposures : pageviews
  const key = JSON.stringify([event.experiment, event.phase, event.arm, ...(pathname === undefined ? [] : [pathname])])
  if (seen.has(key)) return
  seen.add(key)
  sendEvent(apiRoute, event)
}

/** Internal test seam; deliberately not exported by /client. */
export function __resetBeaconsForTests(): void {
  exposures.clear()
  pageviews.clear()
  warnings.clear()
  providers.clear()
}
