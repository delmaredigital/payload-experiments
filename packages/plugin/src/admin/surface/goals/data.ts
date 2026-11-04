import { refusalMessage } from '../../copy/common.js'
import { GOALS_COPY as C } from '../../copy/goals.js'
import { payloadFieldErrors } from '../testDocument.model.js'

export class GoalResponseError extends Error {
  constructor(message: string, public readonly fields: Record<string, string>) { super(message) }
}

/** Map REST refusals while retaining Payload's field validation details. */
export async function goalResponse(response: Response, fallback: string, options?: { notFound?: string }): Promise<unknown> {
  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const fields = payloadFieldErrors(body, '_section', fallback)
    const first = (body as { errors?: { code?: string }[] } | null | undefined)?.errors?.[0]
    throw new GoalResponseError(refusalMessage(first?.code, response.status, Object.values(fields).join(' ') || fallback, options), fields)
  }
  if (body == null) throw new Error(fallback)
  return body
}

export async function goalPages<T>(base: string, collection: 'xp-metrics' | 'xp-experiments', signal: AbortSignal): Promise<T[]> {
  const all: T[] = []
  for (let page = 1; ; page++) {
    const response = await fetch(`${base}/${collection}?depth=0&limit=100&page=${page}`, { credentials: 'include', signal })
    const body = await goalResponse(response, C.loadError) as { docs?: T[]; hasNextPage?: boolean }
    if (!Array.isArray(body.docs)) throw new Error(C.loadError)
    all.push(...body.docs)
    if (!body.hasNextPage) return all
  }
}
