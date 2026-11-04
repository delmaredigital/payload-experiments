'use client'

import { useRef, useState } from 'react'
import { Button } from '../../ui/Button.js'
import type { MakeContentResult as Result } from '../../types/endpoints.js'
import { ACTIONS_COPY as C, contentReportCopy } from '../copy/actions.js'

export function MakeContentResult({ result, onRetry, busy = false }: { result: Result; onRetry: () => void | Promise<void>; busy?: boolean }) {
  const inFlight = useRef(false)
  const [pending, setPending] = useState(false)
  async function retry() {
    if (inFlight.current || busy) return
    inFlight.current = true
    setPending(true)
    try { await onRetry() }
    finally { inFlight.current = false; setPending(false) }
  }
  const failed = result.docs.some(doc => !doc.ok)
  return <div aria-live="polite">
    <ul>{result.docs.map((doc, index) => <li key={`${doc.collection}/${doc.id}/${index}`}>
      {('title' in doc && typeof doc.title === 'string' && doc.title) || `${doc.collection}/${doc.id}`}: {doc.ok ? C.updated : C.failed}
      {doc.detail !== undefined || doc.error !== undefined || !doc.ok ? ` — ${contentReportCopy(doc.detail ?? doc.error, doc.ok)}` : ''}
    </li>)}</ul>
    {failed ? <><p>{C.partial}</p><Button disabled={busy || pending} onClick={() => { void retry() }}>{C.retry}</Button></> : null}
  </div>
}
