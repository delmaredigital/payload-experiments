import { MAX_EVENTS_PER_BODY } from '../constants.js'

export class EventsBodyError extends Error {
  constructor(public readonly status: 413 | 422, public readonly code: 'body-too-large' | 'invalid-body', message: string) { super(message) }
}

/** Bound retained bytes while reading the original Fetch stream, before parsing. */
export async function readEvents(body: ReadableStream<Uint8Array> | null | undefined, maxBytes: number): Promise<unknown[]> {
  if (!body) throw new EventsBodyError(422, 'invalid-body', 'Expected an events array')
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        // Cancellation must not wait for an uncooperative sender to finish.
        void reader.cancel().catch(() => {})
        throw new EventsBodyError(413, 'body-too-large', 'Events body is too large')
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('events' in parsed)
      || !Array.isArray(parsed.events) || parsed.events.length > MAX_EVENTS_PER_BODY) {
      throw new Error('Expected at most 20 events')
    }
    return parsed.events
  } catch (error) {
    if (error instanceof EventsBodyError) throw error
    throw new EventsBodyError(422, 'invalid-body', 'Invalid events body')
  } finally {
    reader.releaseLock()
  }
}
