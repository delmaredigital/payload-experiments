'use client'
import { theme } from '../theme.js'

import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button, TextInput } from '@payloadcms/ui'
import type { DocId } from '../../types/contracts.js'
import type { MakeContentResult as ContentResult } from '../../types/endpoints.js'
import { expectedConfirm, matchesConfirm } from '../../transitions/confirmPhrases.js'
import type { ApiResult } from '../api.js'
import { useApi } from '../useApi.js'
import { reloadPage } from '../reload.js'
import { ACTIONS_COPY as C } from '../copy/actions.js'
import { API_MESSAGES } from '../copy/common.js'
import type { ExperimentAction } from './actions.model.js'
import { MakeContentResult } from './MakeContentResult.js'

export function DialogFrame({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const heading = useId()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    ref.current?.focus()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  return createPortal(<div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: theme.color.overlay, display: 'grid', placeItems: 'center' }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={heading} tabIndex={-1}
      style={{ background: theme.color.bg, color: theme.color.text, border: `1px solid ${theme.color.borderStrong}`,
        padding: '2rem', width: 'min(36rem, 90vw)', maxHeight: '90vh', overflow: 'auto', borderRadius: theme.radius.small }}
      onKeyDown={event => {
        if (event.defaultPrevented) return
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
        if (event.key === 'Tab') {
          const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? [])
          const first = items[0], last = items.at(-1)
          if (!first) { event.preventDefault(); ref.current?.focus() }
          else if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first.focus() }
        }
      }}>
      <h2 id={heading}>{title}</h2>{children}
    </div>
  </div>, document.body)
}

export function ConfirmDialog({ id, action, winnerLabel, onClose }: {
  id: DocId; action: ExperimentAction; winnerLabel: string; onClose: () => void
}) {
  const api = useApi()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [error, setError] = useState<Extract<ApiResult<unknown>, { ok: false }> | null>(null)
  const [content, setContent] = useState<ContentResult | null>(null)
  const phrase = action.confirm.phrase ? expectedConfirm(action.confirm.phrase.action, winnerLabel) : null
  const enabled = !busy && (!phrase || matchesConfirm(phrase, typed))
  async function submit() {
    if (inFlight.current || !enabled) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    let result: ApiResult<unknown>
    if (action.archive) result = await api.archive(id, { ...action.archive, ...(phrase ? { confirmation: typed.trim() } : {}) })
    else if (action.id === 'start') result = await api.start(id)
    else if (action.id === 'stop') result = await api.stop(id)
    else if (action.id === 'release-holdout') result = await api.releaseHoldout(id)
    else {
      const response = await api.makeContent(id)
      if (response.ok && response.data) { setContent(response.data); inFlight.current = false; setBusy(false); return }
      result = response
    }
    if (result.ok && action.id !== 'make-content') { reloadPage(); return }
    inFlight.current = false
    setBusy(false)
    setError(!result.ok ? result : { ok: false, status: 0, message: API_MESSAGES.unreadable, retryable: true })
  }
  function close() {
    if (busy) return
    if (content) reloadPage()
    onClose()
  }
  return <DialogFrame title={action.confirm.title} onClose={close}>
    {content ? <MakeContentResult result={content} onRetry={submit} busy={busy} /> : <>
      <p>{action.confirm.body}</p>
      {phrase ? <><p>{C.typePhrase} <strong>{phrase}</strong></p>
        <TextInput path="xp-confirmation" hasMany={false} label={C.confirmation} value={typed} readOnly={busy}
          onChange={event => setTyped(event.target.value)} /></> : null}
    </>}
    {error ? <p role="alert">{error.message}</p> : null}
    {content ? null : <Button disabled={!enabled} onClick={() => { void submit() }}>{action.label}</Button>}
    {error?.retryable ? <Button disabled={!enabled} onClick={() => { void submit() }}>{C.retry}</Button> : null}
    <Button disabled={busy} onClick={close}>{content ? C.done : C.cancel}</Button>
  </DialogFrame>
}
