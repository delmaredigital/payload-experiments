export type DocsResult<T> = { ok: true; docs: T[] } | { ok: false; status: number; body: unknown }

/** A successful REST response did not contain a readable document list. */
export class DocsResponseError extends Error {}

/** Read every Payload REST page with the caller's credentials and cancellation. Transport,
 * invalid successful responses and aborts throw; HTTP refusals retain their status/body. */
export async function fetchAllDocs<T>(url: string, options: Pick<RequestInit, 'credentials' | 'signal'> = {}): Promise<DocsResult<T>> {
  const [path, query] = url.split('?')
  const params = new URLSearchParams(query)
  params.set('limit', '100')
  const docs: T[] = []
  for (let page = 1; ; page++) {
    options.signal?.throwIfAborted()
    params.set('page', String(page))
    const response = await fetch(`${path}?${params}`, options)
    const body: unknown = await response.json().catch(() => {
      if (response.ok) throw new DocsResponseError()
      return undefined
    })
    options.signal?.throwIfAborted()
    if (!response.ok) return { ok: false, status: response.status, body }
    const data = body as { docs?: T[]; hasNextPage?: boolean; totalPages?: number } | null
    if (!Array.isArray(data?.docs)) throw new DocsResponseError()
    docs.push(...data.docs)
    if (data.hasNextPage === false || (data.hasNextPage !== true && !(typeof data.totalPages === 'number' && page < data.totalPages))) {
      return { ok: true, docs }
    }
  }
}
