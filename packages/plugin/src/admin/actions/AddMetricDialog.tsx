'use client'

import { useEffect, useRef, useState } from 'react'
import { Button, useConfig } from '@payloadcms/ui'
import type { DocId } from '../../types/contracts.js'
import type { AddMetricBody } from '../../types/endpoints.js'
import { DialogFrame } from './ConfirmDialog.js'
import { useApi } from '../useApi.js'
import { reloadPage } from '../reload.js'
import { REVIEW_COPY as C } from '../copy/review.js'
import { ACTIONS_COPY } from '../copy/actions.js'
import { API_MESSAGES, refusalMessage } from '../copy/common.js'

export function AddMetricDialog({ id, attachedMetrics, onClose }: {
  id: DocId; attachedMetrics: readonly DocId[]; onClose: () => void
}) {
  const api = useApi()
  const { config } = useConfig()
  const [metrics, setMetrics] = useState<Array<{ id: DocId; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [metric, setMetric] = useState('')
  const [role, setRole] = useState<AddMetricBody['role']>('secondary')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const response = await fetch(`${config.routes.api.replace(/\/$/, '')}/xp-metrics?depth=0&limit=100`, {
          credentials: 'include', signal: controller.signal,
        })
        if (!response.ok) throw new Error(refusalMessage(undefined, response.status))
        const data = await response.json() as { docs: Array<{ id: DocId; name: string }> }
        if (!Array.isArray(data.docs)) throw new Error(API_MESSAGES.unreadable)
        if (!controller.signal.aborted) setMetrics(data.docs)
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : API_MESSAGES.network)
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    return () => controller.abort()
  }, [config.routes.api])
  const attached = new Set(attachedMetrics.map(String))
  const available = metrics.filter(item => !attached.has(String(item.id)))
  const selected = available.find(item => String(item.id) === metric)
  async function submit() {
    if (inFlight.current || loading || !selected) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    const body: AddMetricBody = { metric: selected.id, role }
    const result = await api.addMetric(id, body)
    if (result.ok) { reloadPage(); return }
    setError(result.message)
    inFlight.current = false
    setBusy(false)
  }
  return <DialogFrame title={C.addMetric} onClose={() => { if (!inFlight.current) onClose() }}>
    {loading ? <p role="status">{C.loadingMetrics}</p> : null}
    <label>{C.role}<select value={role} disabled={busy} onChange={event => setRole(event.target.value as AddMetricBody['role'])}>
      <option value="secondary">{C.supporting}</option><option value="guardrail">{C.guardrail}</option>
    </select></label>
    <label>{C.metric}<select value={metric} disabled={busy || loading} onChange={event => setMetric(event.target.value)}>
      <option value="">{C.chooseMetric}</option>
      {available.map(item => <option key={item.id} value={String(item.id)}>{item.name}</option>)}
    </select></label>
    {!loading && !error && !available.length ? <p>{C.noMetrics}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <Button disabled={busy || loading || !selected} onClick={() => { void submit() }}>{C.addMetric}</Button>
    <Button disabled={busy} onClick={() => { if (!inFlight.current) onClose() }}>{ACTIONS_COPY.cancel}</Button>
  </DialogFrame>
}
