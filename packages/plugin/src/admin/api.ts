import type { DocId } from '../types/contracts.js'
import type {
  AddMetricBody, AllocateBody, ArchiveBody, DecideBody, ErrorEnvelope, MakeContentResult,
  PreflightResult, PreviewTokenResult, RefusalCode, ResultsResponse, SummaryResponse, TransitionSuccess,
} from '../types/endpoints.js'
import { API_MESSAGES, refusalMessage } from './copy/common.js'

export type ApiResult<T> = { ok: true; data: T } | {
  ok: false; status: number; code?: RefusalCode; message: string; retryable: boolean
}

export function createApi(apiBase: string) {
  const base = `${apiBase.replace(/\/$/, '')}/xp/experiments`
  const route = (id: DocId, action: string) => `${base}/${encodeURIComponent(id)}/${action}`

  async function request<T>(path: () => string, method: 'GET' | 'POST', body?: unknown): Promise<ApiResult<T>> {
    try {
      const response = await fetch(path(), {
        method, credentials: 'include',
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      })
      let data: unknown
      try { data = await response.json() } catch {
        if (response.ok) return { ok: true, data: undefined as T }
        return { ok: false, status: response.status,
          ...(response.status === 501 ? { code: 'not-implemented' as const } : {}),
          message: refusalMessage(undefined, response.status),
          retryable: response.status >= 500 && response.status !== 501 }
      }
      if (response.ok) return { ok: true, data: data as T }
      // Payload's own errors may omit code; future server codes retain their message.
      const envelope = data as { errors?: Array<Partial<ErrorEnvelope['errors'][number]>> } | null
      const error = Array.isArray(envelope?.errors) ? envelope.errors[0] : undefined
      const code = response.status === 501 ? 'not-implemented' : typeof error?.code === 'string' ? error.code : undefined
      return { ok: false, status: response.status, ...(code ? { code } : {}),
        message: refusalMessage(code, response.status, typeof error?.message === 'string' ? error.message : undefined),
        retryable: code === 'commit-unverified' || (response.status >= 500 && response.status !== 501) }
    } catch {
      return { ok: false, status: 0, message: API_MESSAGES.network, retryable: true }
    }
  }
  const post = <T>(id: DocId, action: string, body?: unknown) => request<T>(() => route(id, action), 'POST', body)
  return {
    start: (id: DocId) => post<TransitionSuccess>(id, 'start'),
    allocate: (id: DocId, body: AllocateBody) => post<TransitionSuccess>(id, 'allocate', body),
    addMetric: (id: DocId, body: AddMetricBody) => post<TransitionSuccess>(id, 'add-metric', body),
    stop: (id: DocId) => post<TransitionSuccess>(id, 'stop'),
    decide: (id: DocId, body: DecideBody) => post<TransitionSuccess>(id, 'decide', body),
    releaseHoldout: (id: DocId) => post<TransitionSuccess>(id, 'release-holdout'),
    makeContent: (id: DocId) => post<MakeContentResult>(id, 'make-content'),
    archive: (id: DocId, body: ArchiveBody) => post<TransitionSuccess>(id, 'archive', body),
    preflight: (id: DocId) => request<PreflightResult>(() => route(id, 'preflight'), 'GET'),
    previewToken: (id: DocId, arm: string) => request<PreviewTokenResult>(() => `${route(id, 'preview-token')}?arm=${encodeURIComponent(arm)}`, 'GET'),
    results: (id: DocId, options: { phase?: number; series?: boolean } = {}) => request<ResultsResponse>(() => {
      const query = new URLSearchParams()
      if (options.phase !== undefined) query.set('phase', String(options.phase))
      if (options.series) query.set('series', '1')
      const qs = query.toString()
      return `${route(id, 'results')}${qs ? `?${qs}` : ''}`
    }, 'GET'),
    recompute: (id: DocId) => post<{ snapshotId: string }>(id, 'recompute'),
    summary: async (ids: readonly DocId[]): Promise<ApiResult<SummaryResponse>> => {
      const data: SummaryResponse = {}
      // Wire format: comma-separated ids, each URI-encoded; at most 100 per request.
      for (let offset = 0; offset < ids.length; offset += 100) {
        const result = await request<SummaryResponse>(() => `${base}/summary?ids=${ids.slice(offset, offset + 100).map(id => encodeURIComponent(id)).join(',')}`, 'GET')
        if (!result.ok) return result
        Object.assign(data, result.data)
      }
      return { ok: true, data }
    },
  }
}
