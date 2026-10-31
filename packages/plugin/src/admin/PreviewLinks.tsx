'use client'

import { useRef, useState } from 'react'
import { Button } from '@payloadcms/ui'
import type { DocId } from '../types/contracts.js'
import type { PreflightResult } from '../types/endpoints.js'
import { armLabel } from './labels.js'
import { useApi } from './useApi.js'
import { REVIEW_COPY as C } from './copy/review.js'
import { API_MESSAGES } from './copy/common.js'

export function PreviewLinks({ experimentId, placements, arms }: {
  experimentId: DocId; placements: PreflightResult['placements']; arms: readonly { key: string; kind?: string; label?: string }[]
}) {
  const api = useApi()
  const inFlight = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function preview(url: string, arm: string) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await api.previewToken(experimentId, arm)
      if (!result.ok) { setError(result.message); return }
      if (!result.data?.token) { setError(API_MESSAGES.unreadable); return }
      const target = new URL(url, window.location.origin)
      target.searchParams.set('xp_preview', result.data.token)
      window.open(target.href, '_blank', 'noopener,noreferrer')
    } catch { setError(API_MESSAGES.failed) }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <div className="xp-preview-links">
    {placements.map(placement => <div key={`${placement.collection}/${placement.id}`}>
      <p>{placement.title}</p>
      {placement.url ? arms.filter(arm => arm.kind !== 'holdout' && arm.key !== 'holdout').map(arm =>
        <Button key={arm.key} disabled={busy} onClick={() => { void preview(placement.url!, arm.key) }}>
          {C.preview} {arm.label?.trim() || armLabel(arm.key)}
        </Button>) : <Button disabled>{C.noPreview}</Button>}
    </div>)}
    {error ? <p role="alert">{error}</p> : null}
  </div>
}
