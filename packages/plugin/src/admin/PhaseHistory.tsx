'use client'
import { useConfig, useDocumentInfo, useFormFields } from '@payloadcms/ui'
import { useEffect, useState } from 'react'
import type { UIFieldClientProps } from 'payload'
import type { HistoryPhase } from './phaseHistory.model.js'
import { phaseHistory } from './phaseHistory.model.js'
import { HISTORY_COPY } from './copy/history.js'

export function PhaseHistory(_props: UIFieldClientProps) {
  const { id, data } = useDocumentInfo()
  const { config } = useConfig()
  const api = config.routes.api
  const decidedBy = useFormFields(([fields]) => {
    const decision = fields.decision?.value
    return fields['decision.decidedBy']?.value
      ?? (decision && typeof decision === 'object' && 'decidedBy' in decision ? decision.decidedBy : undefined)
  })
    ?? data?.decision?.decidedBy
  const [state, setState] = useState<{ key: string; docs: HistoryPhase[] } | null>(null)
  const key = `${api}:${id}`
  useEffect(() => {
    setState(null)
    if (id == null) return
    const controller = new AbortController()
    async function load() {
      const docs: HistoryPhase[] = []
      let page = 1
      while (!controller.signal.aborted) {
        const query = new URLSearchParams({ depth: '0', sort: 'phase,startedAt', limit: '100', page: String(page), 'where[experiment][equals]': String(id) })
        const response = await fetch(`${api}/xp-phases?${query}`, { credentials: 'include', signal: controller.signal })
        if (!response.ok) { if (!controller.signal.aborted) setState(null); return }
        const result = await response.json() as { docs: HistoryPhase[]; hasNextPage?: boolean }
        docs.push(...result.docs)
        if (!result.hasNextPage) break
        page++
      }
      if (!controller.signal.aborted) setState({ key, docs })
    }
    void load().catch(() => { if (!controller.signal.aborted) setState(null) })
    return () => controller.abort()
  }, [api, id, key])
  if (id == null || state?.key !== key) return null
  const history = phaseHistory(state.docs, { decidedBy })
  return <section aria-label={HISTORY_COPY.rounds}>
    <ul>{history.rows.map(row => <li key={`${row.phase}-${row.phaseKind}`}>{row.text}</li>)}</ul>
    {history.decision ? <p>{history.decision}</p> : null}
  </section>
}
