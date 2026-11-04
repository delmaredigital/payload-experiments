'use client'
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '../../ui/Button.js'
import { TextInput } from '../../ui/Inputs.js'
import { Dialog } from '../../ui/Dialog.js'
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

export function DialogFrame({ title, onClose, children, initialFocus, dismissible = true }: { dismissible?: boolean; initialFocus?: 'cancel'; title: string; onClose: () => void; children: ReactNode }) {
  return <Dialog open dismissible={dismissible} initialFocus={initialFocus} title={title} onClose={onClose}>{children}</Dialog>
}

export function ConfirmDialog({ id, action, winnerLabel, onClose, canManage = false, isDecided = false }: {
  canManage?: boolean; isDecided?: boolean; id: DocId; action: ExperimentAction; winnerLabel: string; onClose: () => void
}) {
  const api = useApi()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [reportBusy, setReportBusy] = useState(false)
  const inFlight = useRef(false)
  const [error, setError] = useState<Extract<ApiResult<unknown>, { ok: false }> | null>(null)
  const [content, setContent] = useState<ContentResult | null>(null)
  const phrase = action.confirm.phrase ? expectedConfirm(action.confirm.phrase.action, winnerLabel) : null
  const enabled = !busy && (!phrase || matchesConfirm(phrase, typed))
  async function submit(finish = false) {
    if (inFlight.current || !enabled) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    let result: ApiResult<unknown>
    if (finish) result = await api.archive(id, { mode: 'after-content' })
    else if (action.archive) result = await api.archive(id, { ...action.archive, ...(phrase ? { confirmation: typed.trim() } : {}) })
    else if (action.id === 'start') result = await api.start(id)
    else if (action.id === 'stop') result = await api.stop(id)
    else if (action.id === 'release-holdout') result = await api.releaseHoldout(id)
    else {
      const response = await api.makeContent(id)
      if (response.ok && response.data) { setContent(response.data); inFlight.current = false; setBusy(false); return }
      result = response
    }
    if (result.ok && (finish || action.id !== 'make-content')) { reloadPage(); return }
    inFlight.current = false
    setBusy(false)
    setError(!result.ok ? result : { ok: false, status: 0, message: API_MESSAGES.unreadable, retryable: true })
  }
  function close() {
    if (busy || reportBusy) return
    if (content) reloadPage()
    onClose()
  }
  return <DialogFrame dismissible={!busy && !reportBusy} initialFocus={action.id === 'start' ? undefined : 'cancel'} title={action.confirm.title} onClose={close}>
    {content ? <MakeContentResult result={content} id={id} api={api} canManage={canManage} isDecided={content.doc?.status ? content.doc.status === 'decided' : isDecided}
      onRetry={() => submit()} onFinish={() => submit(true)} busy={busy} onBusyChange={setReportBusy} /> : <>
      <p>{action.confirm.body}</p>
      {phrase ? <><p>{C.typePhrase} <strong>{phrase}</strong></p>
        <TextInput id="xp-confirmation" label={C.confirmation} value={typed} readOnly={busy}
          onChange={event => setTyped(event.target.value)} /></> : null}
    </>}
    {error ? <p role="alert">{error.message}</p> : null}
    {content ? null : <Button disabled={!enabled} onClick={() => { void submit() }}>{action.label}</Button>}
    {error?.retryable && !content ? <Button disabled={!enabled} onClick={() => { void submit() }}>{C.retry}</Button> : null}
    <Button data-dialog-cancel disabled={busy || reportBusy} onClick={close}>{content ? C.done : C.cancel}</Button>
  </DialogFrame>
}
