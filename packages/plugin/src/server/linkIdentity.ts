import { safeError } from '../log.js'
import type { Payload } from 'payload'
import { NextRequest } from 'next/server.js'
import type { ExperimentsServerRuntime } from '../types/runtime.js'
import { insertIdentityOnOwnConnection, type IdentityWriteOutcome } from '../db/identities.js'
import { readUnitCookie } from '../runtime/cookie.js'

export type LinkIdentityOutcome = IdentityWriteOutcome | 'failed'

/**
 * verified: true means this request proves, in this browser, that the person owns
 * the account: a magic-link or one-time-code callback, password sign-in, or OAuth
 * callback. It does not mean "a session exists" or "the email is verified".
 * Never throws into registration or sign-in.
 */
export async function linkIdentity<TUser extends { id: string | number } = { id: string | number }>(serverRuntime: ExperimentsServerRuntime<TUser>, opts: { headers: Headers; userId: string; verified: boolean }): Promise<LinkIdentityOutcome> {
  let payload: Payload | undefined
  try {
    const runtime = serverRuntime.proxyRuntime
    // Consent sees cookies and headers only; the URL is a placeholder.
    const consent = runtime.cookie.consent?.(new NextRequest('http://consent.invalid/', { headers: opts.headers })) !== false
    if (!consent) return 'skipped'
    const anonymousId = readUnitCookie(opts.headers, runtime)
    if (!anonymousId) return 'skipped'
    payload = await serverRuntime.getPayload()
    return await insertIdentityOnOwnConnection(payload, { anonymousId, userId: opts.userId, verified: opts.verified })
  } catch (error) {
    try {
      if (payload) payload.logger.error({ err: safeError(error) }, 'Experiments: linkIdentity failed')
      else console.error('[payload-experiments] linkIdentity failed', safeError(error))
    } catch { /* Never break sign-in, even if logging fails. */ }
    return 'failed'
  }
}
