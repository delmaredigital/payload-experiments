import type { Payload } from 'payload'
import { NextRequest } from 'next/server.js'
import type { ExperimentsServerRuntime } from '../types/runtime.js'
import { insertIdentityOnOwnConnection } from '../db/identities.js'
import { readUnitCookie } from '../runtime/cookie.js'

export async function linkIdentity<TUser extends { id: string | number } = { id: string | number }>(serverRuntime: ExperimentsServerRuntime<TUser>, opts: { headers: Headers; userId: string }): Promise<void> {
  let payload: Payload | undefined
  try {
    const runtime = serverRuntime.proxyRuntime
    // Consent sees cookies and headers only; the URL is a placeholder.
    let consent = true
    try { consent = runtime.cookie.consent?.(new NextRequest('http://consent.invalid/', { headers: opts.headers })) !== false } catch {
      console.error('[payload-experiments] consent failed; treating consent as false')
      consent = false
    }
    if (!consent) return
    const anonymousId = readUnitCookie(opts.headers, runtime)
    if (!anonymousId) return
    payload = await serverRuntime.getPayload()
    await insertIdentityOnOwnConnection(payload, { anonymousId, userId: opts.userId })
  } catch (error) {
    try { payload?.logger.error({ err: error, msg: 'Experiments: linkIdentity failed' }) } catch { /* Never break sign-in, even if logging fails. */ }
  }
}
