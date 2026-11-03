import { safeError } from '../log.js'
import type { Payload } from 'payload'
import { NextRequest } from 'next/server.js'
import type { ExperimentsServerRuntime } from '../types/runtime.js'
import { pooledExecutor } from '../db/executor.js'
import { insertEvents } from '../db/events.js'
import { readUnitCookie } from '../runtime/cookie.js'

export async function trackConversion<TUser extends { id: string | number } = { id: string | number }>(serverRuntime: ExperimentsServerRuntime<TUser>, event: { eventName: string; value?: number; idempotencyKey: string; userId?: string; headers?: Headers }): Promise<void> {
  let payload: Payload | undefined
  try {
    let headers = event.headers
    if (!headers) {
      try { headers = await (await import('next/headers.js')).headers() }
      catch { /* A user-only server conversion need not have a Next request. */ }
    }
    const runtime = serverRuntime.proxyRuntime
    // Consent sees cookies and headers only; the URL is a placeholder.
    let consent = true
    try { consent = runtime.cookie.consent?.(new NextRequest('http://consent.invalid/', { headers })) !== false } catch {
      console.error('[payload-experiments] consent failed; treating consent as false')
      consent = false
    }
    if (!consent) return
    payload = await serverRuntime.getPayload()
    if (typeof event.idempotencyKey !== 'string' || !event.idempotencyKey.trim()) {
      try { payload.logger.warn('Experiments: trackConversion requires a non-empty idempotencyKey') } catch { /* Never break the host's write path. */ }
      return
    }
    const visitorId = headers ? readUnitCookie(headers, runtime) : null
    let userId = event.userId
    if (!userId && serverRuntime.getUser) {
      try {
        const user = await serverRuntime.getUser()
        if (user) userId = serverRuntime.userIdOf(user)
      } catch (error) {
        try { payload.logger.error({ err: safeError(error) }, 'Experiments: trackConversion getUser failed') } catch { /* Still record the visitor conversion if logging fails. */ }
      }
    }
    if (!visitorId && !userId) return
    await insertEvents(pooledExecutor(payload), [{ type: 'conversion', eventName: event.eventName, value: event.value ?? 1,
      unitId: visitorId ?? userId!, unitType: visitorId ? 'visitor' : 'user', userId,
      dedupeKey: `conversion:s:${event.idempotencyKey}`, ts: new Date().toISOString() }], message => payload!.logger.error(message))
  } catch (error) {
    try { payload?.logger.error({ err: safeError(error) }, 'Experiments: trackConversion failed') } catch { /* Never break the host's write path. */ }
  }
}
