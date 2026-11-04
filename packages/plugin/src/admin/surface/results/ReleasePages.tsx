'use client'
import { useEffect, useRef, useState } from 'react'
import { useAuth, useConfig } from '@payloadcms/ui'
import type { DocId } from '../../../types/contracts.js'
import { Button } from '../../../ui/Button.js'
import { Dialog } from '../../../ui/Dialog.js'
import { createApi } from '../../api.js'
import { ACTIONS_COPY } from '../../copy/actions.js'
import { RESULTS_COPY as C, pagesReleasedCopy } from '../../copy/results.js'
import { formatDate } from '../../format/date.js'
import { pagesReleasedBy, type PageReleaseDecision } from '../../results/releasePages.model.js'

export function ReleasePagesDialog({ id, apiRoute, onClose, onSuccess, onRefusal }: {
  id: DocId; apiRoute: string; onClose(): void; onSuccess(): void; onRefusal(message: string): void
}) {
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  async function submit() {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    const result = await createApi(apiRoute).releasePages(id)
    if (!mounted.current) return
    onClose()
    if (result.ok) onSuccess()
    else onRefusal(result.message)
  }
  return <Dialog open title={C.releasePages} initialFocus="cancel" dismissible={!busy} onClose={() => { if (!inFlight.current) onClose() }}>
    <p>{C.releasePagesBody}</p>
    <div className="xp-ui-button-group">
      <Button data-dialog-cancel disabled={busy} onClick={onClose}>{ACTIONS_COPY.cancel}</Button>
      <Button variant="primary" busy={busy} onClick={() => { void submit() }}>{C.releasePages}</Button>
    </div>
  </Dialog>
}

/** An inaccessible or deleted author never hides the recorded release date. */
export function PagesReleased({ decision, apiRoute }: { decision: PageReleaseDecision; apiRoute: string }) {
  const { user } = useAuth()
  const { config } = useConfig()
  const collection = config.admin.user
  const by = decision.pagesReleasedBy
  const [resolved, setResolved] = useState<{ key: string; author: { name?: string | null; email?: string | null } } | null>(null)
  const key = JSON.stringify([apiRoute, collection, by])
  const own = pagesReleasedBy(by, user?.id)
  useEffect(() => {
    if (!by || own || !collection) return
    const controller = new AbortController()
    const query = new URLSearchParams({ depth: '0', 'select[name]': 'true', 'select[email]': 'true' })
    void (async () => {
      try {
        const response = await fetch(`${apiRoute.replace(/\/$/, '')}/${encodeURIComponent(collection)}/${encodeURIComponent(by)}?${query}`, {
          method: 'GET', credentials: 'include', signal: controller.signal,
        })
        if (!response.ok) return
        const author = await response.json() as { name?: unknown; email?: unknown } | null
        if (!controller.signal.aborted && author) setResolved({ key, author: {
          name: typeof author.name === 'string' ? author.name : null,
          email: typeof author.email === 'string' ? author.email : null,
        } })
      } catch { /* Keep the audit date when the author cannot be read. */ }
    })()
    return () => controller.abort()
  }, [apiRoute, by, collection, key, own])
  const name = own ?? pagesReleasedBy(by, user?.id, resolved?.key === key ? resolved.author : null)
  return <p>{pagesReleasedCopy(formatDate(decision.pagesReleasedAt), name)}</p>
}
