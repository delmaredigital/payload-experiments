import { GOALS_COPY as C } from '../../copy/goals.js'
import { payloadFieldErrors } from '../testDocument.model.js'

/** REST refusals remain the server's words, including nested field validation errors. */
export async function goalResponse(response: Response, fallback: string): Promise<unknown> {
  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const messages = Object.values(payloadFieldErrors(body, '_section', fallback))
    throw new Error(messages.length ? messages.join(' ') : fallback)
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
