'use client'

import { useEffect, useMemo, useState } from 'react'
import type { DocId, Status } from '../../../types/contracts.js'
import type { PhaseSummary, ResultsResponse } from '../../../types/endpoints.js'
import { createApi, type ApiResult } from '../../api.js'
import { API_MESSAGES, refusalMessage } from '../../copy/common.js'
import { defaultRound } from '../../results/results.model.js'

export interface ResultsDocument {
  status: Status
  arms: Array<{ key: string; kind?: string; label?: string }>
  decision?: { phase: number; winnerArm?: string } | null
  analysis?: { plannedDurationDays?: number | null } | null
  layer?: unknown
  layerSlices?: number[]
  allocation?: number
}
export type ResultsLoadState = 'loading' | 'ready' | 'empty' | 'forbidden' | 'missing' | 'error'
type View = { key: string; round: number | null; state: ResultsLoadState; data?: ResultsResponse; doc?: ResultsDocument; error?: string; phases?: PhaseSummary[] }

// The shared API has no AbortSignal parameter. Keep abortable GETs local to this
// owned surface rather than changing the shared API contract in this lane.
async function read<T>(url: string, signal: AbortSignal): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, { method: 'GET', credentials: 'include', signal })
    const data = await response.json().catch(() => undefined) as T | undefined
    if (response.ok) return { ok: true, data }
    const envelope = data as { errors?: Array<{ message?: string }> } | undefined
    return { ok: false, status: response.status, message: refusalMessage(undefined, response.status, envelope?.errors?.[0]?.message), retryable: response.status >= 500 }
  } catch {
    return { ok: false, status: 0, message: API_MESSAGES.network, retryable: true }
  }
}

export function useResults(id: DocId, { apiRoute, canReadResults, canManage = true }: { apiRoute: string; canReadResults: boolean; canManage?: boolean }) {
  const base = apiRoute.replace(/\/$/, '')
  const key = JSON.stringify([base, String(id), canReadResults, canManage])
  const api = useMemo(() => createApi(base), [base])
  const [selection, setSelection] = useState<{ key: string; round: number | null }>({ key, round: null })
  const round = selection.key === key ? selection.round : null
  const [refresh, setRefresh] = useState(0)
  const [view, setView] = useState<View>({ key, round: null, state: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    const signal = controller.signal
    if (!canReadResults) {
      setView({ key, round, state: 'forbidden' })
      return () => controller.abort()
    }
    setView(previous => ({ key, round, state: 'loading',
      ...(previous.key === key ? { doc: previous.doc, phases: previous.phases, ...(previous.round === round ? { data: previous.data } : {}) } : {}) }))
    const encoded = encodeURIComponent(id)
    const query = new URLSearchParams({ ...(round === null ? {} : { phase: String(round) }), series: '1' })
    void Promise.all([
      canManage ? read<ResultsDocument>(`${base}/xp-experiments/${encoded}?depth=0`, signal)
        : Promise.resolve<ApiResult<ResultsDocument>>({ ok: true, data: undefined }),
      read<ResultsResponse>(`${base}/xp/experiments/${encoded}/results?${query}`, signal),
    ]).then(([document, result]) => {
      if (signal.aborted) return
      const failure = !document.ok ? document : !result.ok ? result : undefined
      if (failure || !document.ok || !result.ok || (canManage && !document.data) || !result.data) {
        const state = failure?.status === 403 ? 'forbidden' : failure?.status === 404 ? 'missing' : 'error'
        setView(previous => ({ key, round, state, phases: previous.key === key ? previous.phases : undefined, error: failure?.message ?? API_MESSAGES.unreadable,
          ...(state === 'error' && previous.key === key && previous.round === round ? { data: previous.data, doc: previous.doc } : {}) }))
        return
      }
      if (round === null) {
        // Readers cannot GET the manager-only experiment collection. The results
        // endpoint already selects the decision round (or latest test round).
        const initial = document.data
          ? defaultRound({ phases: result.data.phases, decision: document.data.decision, status: document.data.status })
          : result.data.decisionSnapshot?.phase ?? result.data.snapshot?.phase
            ?? defaultRound({ phases: result.data.phases, status: 'running' })
        if (initial !== null) {
          setView({ key, round: null, state: 'loading', doc: document.data, phases: result.data.phases, data: { ...result.data, snapshot: null } })
          setSelection({ key, round: initial })
          return
        }
      }
      setView({ key, round, state: result.data.snapshot ? 'ready' : 'empty', doc: document.data, phases: result.data.phases, data: result.data })
    })
    return () => controller.abort()
  }, [base, id, key, canReadResults, canManage, round, refresh])

  const current = view.key === key
  const matching = current && view.round === round
  const state = !canReadResults ? 'forbidden' : matching ? view.state : 'loading'
  const data = matching && canReadResults ? view.data : undefined
  // Preserve options while another round loads; its snapshot is never displayed.
  const phases: PhaseSummary[] = current && canReadResults ? view.phases ?? [] : []
  return {
    api, state, data, phases, round, doc: current && canReadResults ? view.doc : undefined,
    error: matching ? view.error : undefined,
    setRound: (next: number) => setSelection({ key, round: next }),
    reload: () => setRefresh(value => value + 1),
  }
}
