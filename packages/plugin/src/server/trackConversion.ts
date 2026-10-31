import type { Payload } from 'payload'
import { NextRequest } from 'next/server'
import type { ExperimentsServerRuntime } from '../types/runtime.js'
import { pooledExecutor } from '../db/executor.js'
import { insertEvents } from '../db/events.js'
import { verifyUnitCookie } from '../runtime/cookie.js'

export async function trackConversion<TUser extends { id: string | number } = { id: string | number }>(serverRuntime: ExperimentsServerRuntime<TUser>, event: { eventName: string; value?: number; idempotencyKey: string; userId?: string; headers?: Headers }): Promise<void> {
  let payload: Payload | undefined
  try {
    let headers = event.headers
    if (!headers) {
      try { headers = await (await import('next/headers')).headers() }
      catch { /* A user-only server conversion need not have a Next request. */ }
    }
    const runtime = serverRuntime.proxyRuntime
    // Consent sees cookies and headers only; the URL is a placeholder.
    if (runtime.cookie.consent?.(new NextRequest('http://consent.invalid/', { headers })) === false) return
    payload = await serverRuntime.getPayload()
    if (!event.idempotencyKey.trim()) {
      try { payload.logger.warn('Experiments: trackConversion requires a non-empty idempotencyKey') } catch { /* Never break the host's write path. */ }
      return
    }
    const cookie = headers?.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${runtime.cookie.name}=`))?.slice(runtime.cookie.name.length + 1)
    const visitorId = verifyUnitCookie(cookie, runtime.secrets)
    let userId = event.userId
    if (!userId && serverRuntime.getUser) {
      try {
        const user = await serverRuntime.getUser()
        if (user) userId = serverRuntime.userIdOf(user)
      } catch (error) {
        try { payload.logger.error({ err: error, msg: 'Experiments: trackConversion getUser failed' }) } catch { /* Still record the visitor conversion if logging fails. */ }
      }
    }
    if (!visitorId && !userId) return
    await insertEvents(pooledExecutor(payload), [{ type: 'conversion', eventName: event.eventName, value: event.value ?? 1,
      unitId: visitorId ?? userId!, unitType: visitorId ? 'visitor' : 'user', userId,
      dedupeKey: `conversion:s:${event.idempotencyKey}`, ts: new Date().toISOString() }], message => payload!.logger.error(message))
  } catch (error) {
    try { payload?.logger.error({ err: error, msg: 'Experiments: trackConversion failed' }) } catch { /* Never break the host's write path. */ }
  }
}
