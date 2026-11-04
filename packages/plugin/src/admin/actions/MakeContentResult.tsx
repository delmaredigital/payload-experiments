'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { contentDone } from '../../contentDone.js'
import { Button } from '../../ui/Button.js'
import { Banner } from '../../ui/Banner.js'
import type { DocId } from '../../types/contracts.js'
import type { MakeContentResult as Result } from '../../types/endpoints.js'
import type { createApi } from '../api.js'
import { API_MESSAGES } from '../copy/common.js'
import { ACTIONS_COPY as C, contentReportCopy } from '../copy/actions.js'

type Props = {
  result: Result; onRetry: () => void | Promise<void>; busy?: boolean
  id?: DocId; api?: ReturnType<typeof createApi>; canManage?: boolean; isDecided?: boolean
  onFinish?: () => void | Promise<void>; onBusyChange?: (busy: boolean) => void; onActionStart?: () => void
}

export function MakeContentResult({ result, onRetry, busy = false, id, api, canManage = false, isDecided = false, onFinish, onBusyChange, onActionStart }: Props) {
  const inFlight = useRef(false)
  const container = useRef<HTMLDivElement>(null)
  const focusTarget = useRef<HTMLButtonElement | 'finish' | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState({ source: result, docs: result.docs })
  // A Retry supplies a new report. Entry actions use the authoritative returned doc.
  if (report.source !== result) setReport({ source: result, docs: result.docs })
  const docs = report.source === result ? report.docs : result.docs
  const editable = canManage && isDecided
  useLayoutEffect(() => {
    if (busy || pending || !focusTarget.current) return
    const target = focusTarget.current === 'finish'
      ? container.current?.querySelector<HTMLButtonElement>('[data-finish-archiving]') : focusTarget.current
    target?.focus()
    focusTarget.current = null
  }, [docs, busy, pending])
  async function run(action: () => void | Promise<void>) {
    if (inFlight.current || busy) return
    inFlight.current = true
    setPending(true)
    setError(null)
    onActionStart?.()
    onBusyChange?.(true)
    try { await action() }
    catch { setError(API_MESSAGES.network) }
    finally { inFlight.current = false; setPending(false); onBusyChange?.(false) }
  }
  async function changeEntry(entry: Result['docs'][number], button: HTMLButtonElement) {
    if (!editable || !api || id === undefined) return
    const response = await (entry.dismissedAt ? api.restoreContentEntry : api.dismissContentEntry)(id, { collection: entry.collection, id: entry.id })
    if (!response.ok) { setError(response.message); return }
    const decision = response.data?.doc.decision as { contentReport?: { docs?: Result['docs'] } } | undefined
    const updated = decision?.contentReport?.docs?.find(doc => doc.collection === entry.collection && String(doc.id) === String(entry.id))
    if (!updated) { setError(API_MESSAGES.unreadable); return }
    const updatedDocs = docs.map(doc => doc.collection === entry.collection && String(doc.id) === String(entry.id) ? updated : doc)
    focusTarget.current = !entry.dismissedAt && !contentDone(docs) && contentDone(updatedDocs) && onFinish ? 'finish' : button
    setReport(current => ({ ...current, docs: updatedDocs }))
  }
  const retryable = docs.some(doc => !doc.ok && !doc.dismissedAt)
  return <div ref={container} aria-live="polite">
    {error ? <Banner tone="error">{error}</Banner> : null}
    {result.doc?.status === 'archived' ? <p>{C.contentArchived}</p> : null}
    <ul>{docs.map((doc, index) => {
      const label = ('title' in doc && typeof doc.title === 'string' && doc.title) || `${doc.collection}/${doc.id}`
      return <li key={`${doc.collection}/${doc.id}/${index}`}>
        <span>{label}: {doc.ok ? C.updated : doc.dismissedAt ? C.dismissed : C.failed}
          {!doc.dismissedAt && (doc.detail !== undefined || doc.error !== undefined || !doc.ok) ? ` — ${contentReportCopy(doc.detail ?? doc.error, doc.ok)}` : ''}</span>
        {!doc.ok && editable && api && id !== undefined ? <>{doc.dismissedAt ? ' · ' : ' '}
          <Button variant="quiet" size="sm" aria-disabled={busy || pending || undefined}
            aria-label={doc.dismissedAt ? C.undoLabel(label) : C.dismissLabel(label)}
            onClick={event => { const button = event.currentTarget; void run(() => changeEntry(doc, button)) }}>{doc.dismissedAt ? C.undo : C.dismiss}</Button>
        </> : null}
      </li>
    })}</ul>
    {editable && retryable ? <><p>{C.dismissHelp}</p><p>{C.partial}</p><Button aria-disabled={busy || pending || undefined} onClick={() => { void run(onRetry) }}>{C.retry}</Button></> : null}
    {editable && contentDone(docs) && onFinish ? <Button data-finish-archiving variant="primary" disabled={busy || pending} onClick={() => { void run(onFinish) }}>{C.finish}</Button> : null}
  </div>
}
