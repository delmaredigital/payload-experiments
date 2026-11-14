import type { PreflightResult } from '../types/endpoints.js'

export const PREFLIGHT_TIMEOUT_MS = 15_000

/** The answer must support both readiness and placement consumers. */
export function isPreflightResult(value: unknown): value is PreflightResult {
  const data = value as Partial<PreflightResult> | null
  return !!data && Array.isArray(data.placements) && Array.isArray(data.checks) && data.checks.every(check =>
    check && typeof check.code === 'string' && typeof check.ok === 'boolean')
}

/** Bound the response and body read, even when a producer ignores cancellation. */
export async function readPreflight(request: (signal: AbortSignal) => Promise<Response>, signal: AbortSignal) {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancel!: () => void
  const cancelled = new Promise<never>((_, reject) => {
    cancel = () => { clearTimeout(timer); controller.abort(); reject(new Error('Readiness read cancelled')) }
    timer = setTimeout(cancel, PREFLIGHT_TIMEOUT_MS)
  })
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  try {
    return await Promise.race([cancelled, (async () => {
      const response = await request(controller.signal)
      const body: unknown = await response.json().catch(() => undefined)
      return { response, body }
    })()])
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', cancel)
  }
}
