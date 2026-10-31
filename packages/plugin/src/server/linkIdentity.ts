import type { Payload } from 'payload'
import type { ExperimentsServerRuntime } from '../types/runtime.js'
import { insertIdentityOnOwnConnection } from '../db/identities.js'
import { verifyUnitCookie } from '../runtime/cookie.js'

export async function linkIdentity<TUser extends { id: string | number } = { id: string | number }>(serverRuntime: ExperimentsServerRuntime<TUser>, opts: { headers: Headers; userId: string }): Promise<void> {
  let payload: Payload | undefined
  try {
    const runtime = serverRuntime.proxyRuntime
    const cookie = opts.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${runtime.cookie.name}=`))?.slice(runtime.cookie.name.length + 1)
    const anonymousId = verifyUnitCookie(cookie, runtime.secrets)
    if (!anonymousId) return
    payload = await serverRuntime.getPayload()
    await insertIdentityOnOwnConnection(payload, { anonymousId, userId: opts.userId })
  } catch (error) {
    try { payload?.logger.error({ err: error, msg: 'Experiments: linkIdentity failed' }) } catch { /* Never break sign-in, even if logging fails. */ }
  }
}
