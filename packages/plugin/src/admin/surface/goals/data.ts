import { DocsResponseError, fetchAllDocs } from '../../../lib/fetchAllDocs.js'
import { refusalMessage } from '../../../testSurface/copy/common.js'
import { GOALS_COPY as C } from '../../copy/goals.js'
import { payloadFieldErrors } from '../../../testSurface/surface/testDocument.model.js'

export class GoalResponseError extends Error {
  constructor(message: string, public readonly fields: Record<string, string>) { super(message) }
}

/** Map REST refusals while retaining Payload's field validation details. */
export async function goalResponse(response: Response, fallback: string, options?: { notFound?: string }): Promise<unknown> {
  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok) goalRefusal(body, response.status, fallback, options)
  if (body == null) throw new Error(fallback)
  return body
}

function goalRefusal(body: unknown, status: number, fallback: string, options?: { notFound?: string }): never {
  const fields = payloadFieldErrors(body, '_section', fallback)
  const first = (body as { errors?: { code?: string }[] } | null | undefined)?.errors?.[0]
  throw new GoalResponseError(refusalMessage(first?.code, status, undefined, { ...options, fallback }), fields)
}

export async function goalPages<T>(base: string, collection: 'xp-metrics' | 'xp-experiments', signal: AbortSignal): Promise<T[]> {
  const result = await fetchAllDocs<T>(`${base}/${collection}?depth=0`, { credentials: 'include', signal }).catch(cause => {
    if (cause instanceof DocsResponseError) throw new Error(C.loadError)
    throw cause
  })
  if (!result.ok) goalRefusal(result.body, result.status, C.loadError)
  return result.docs
}
