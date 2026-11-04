'use client'
import { useEffect, useRef, useState } from 'react'
import type { ResultsResponse, SummaryResponse } from '../../types/endpoints.js'
import { Button } from '../../ui/Button.js'
import type { EditorExperiment } from './editor.model.js'
import { editorCopy as C } from './copy.js'

type Readout = { headline: string; people: Record<string, number> } | 'unavailable' | null
// Matches admin/results/format.ts formatCount; importing it would pull admin copy into this bundle.
const formatCount = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value)
  ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value) : '—'

export function ResultsReadout({ id, api, experiment }: { id: string | number; api: string; experiment: EditorExperiment }) {
  const [data, setData] = useState<Readout>(null)
  const [refresh, setRefresh] = useState(0)
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    pending.current = true; setBusy(true)
    setData(null)
    async function load() {
      try {
        const [summary, results] = await Promise.all([
          fetch(`${api}/xp/experiments/summary?ids=${encodeURIComponent(id)}`, { credentials: 'include', cache: 'no-store', signal: controller.signal }),
          fetch(`${api}/xp/experiments/${encodeURIComponent(id)}/results`, { credentials: 'include', cache: 'no-store', signal: controller.signal }),
        ])
        if (!summary.ok || !results.ok) throw new Error('unavailable')
        const [summaries, result] = await Promise.all([summary.json() as Promise<SummaryResponse>, results.json() as Promise<ResultsResponse>])
        const entry = summaries[id]
        if (!entry || !Object.hasOwn(entry, 'verdict') || !Object.hasOwn(result, 'snapshot')) throw new Error('unavailable')
        if (!controller.signal.aborted) setData({ headline: entry.verdict?.headline ?? C.collecting,
          people: result.snapshot?.exposures.perArm ?? {} })
      } catch { if (!controller.signal.aborted) setData('unavailable') }
      finally { if (!controller.signal.aborted) { pending.current = false; setBusy(false) } }
    }
    void load()
    return () => controller.abort()
  }, [id, api, refresh])
  return <div className="xp-slot-readout">
    {data === 'unavailable' ? <p className="xp-ui-help">{C.resultsUnavailable}</p> : data ? <>
      <strong>{data.headline}</strong>
      <div className="xp-slot-people">{experiment.arms.map(arm => <span key={arm.key}>{C.people(arm.label, formatCount(data.people[arm.key] ?? 0))}</span>)}</div>
    </> : <p className="xp-ui-help">{C.loading}</p>}
    <Button variant="quiet" size="sm" disabled={busy} onClick={() => {
      if (pending.current) return
      pending.current = true
      setRefresh(value => value + 1)
    }}>{C.refresh}</Button>
  </div>
}
