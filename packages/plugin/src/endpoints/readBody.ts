import type { PayloadRequest } from 'payload'

export async function readBody(req: PayloadRequest): Promise<unknown> {
  if (req.data !== undefined) {
    if (Buffer.byteLength(JSON.stringify(req.data)) > 16 * 1024) throw new RangeError()
    return req.data
  }
  if (!req.body) return {}
  const reader = req.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 16 * 1024) { void reader.cancel().catch(() => {}); throw new RangeError() }
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally { reader.releaseLock() }
}

