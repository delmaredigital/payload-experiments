'use client'

import { useRef, useState } from 'react'
import { Button } from '../ui/Button.js'
import type { DocId } from '../types/contracts.js'
import type { PreflightResult } from '../types/endpoints.js'
import { armLabel } from './labels.js'
import { useApi } from './useApi.js'
import { REVIEW_COPY as C } from './copy/review.js'
import { TEST_PAGE } from './copy/testPage.js'
import { API_MESSAGES, refusalMessage } from './copy/common.js'
import { actionablePreviewPages } from './previewLinks.model.js'

export function PreviewLinks({ experimentId, placements, arms, flagPoint }: {
  flagPoint?: string; experimentId: DocId; placements: PreflightResult['placements']; arms: readonly { key: string; kind?: string; label?: string }[]
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
    let win: Window | null = null
    try {
      win = window.open('', '_blank')
      if (!win) { setError(C.previewBlocked); return }
      // Clearing opener immediately gives the same opener protection as noopener: the
      // previewed page cannot reach window.opener. The admin URL may be sent as
      // referrer to the host's own site (resolved against location.origin); accepted.
      try { win.opener = null } catch { /* Some browsers refuse this assignment. */ }
      const result = await api.previewToken(experimentId, arm)
      // The person closed the blank tab while the token loaded: nothing to show or report.
      if (win.closed) return
      if (!result.ok) {
        win.close()
        setError(result.status === 0 ? API_MESSAGES.network : refusalMessage(result.code, result.status))
        return
      }
      if (typeof result.data?.token !== 'string' || !result.data.token) { win.close(); setError(API_MESSAGES.unreadable); return }
      const target = new URL(url, window.location.origin)
      target.searchParams.set('xp_preview', result.data.token)
      win.location.replace(target.href)
    } catch { win?.close(); setError(API_MESSAGES.failed) }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <div className="xp-preview-links">
    {actionablePreviewPages(placements, flagPoint).map(placement => <div className="xp-preview-row" key={placement.key}>
      <p>{placement.title}{placement.slotCount > 1 ? ` ${C.placedTimes(placement.slotCount)}` : null}</p>
      <div className="xp-ui-button-group">{placement.url ? arms.filter(arm => arm.kind !== 'holdout' && arm.key !== 'holdout').map(arm =>
        <Button variant="secondary" size="sm" key={arm.key} disabled={busy} onClick={() => { void preview(placement.url!, arm.key) }}>
          {C.preview} {arm.label?.trim() || armLabel(arm.key)}
        </Button>) : null}
        {placement.editorUrl ? <Button variant="link" size="sm" href={placement.editorUrl}>{TEST_PAGE.editOnPage}</Button> : null}</div>
    </div>)}
    {error ? <p role="alert">{error}</p> : null}
  </div>
}
