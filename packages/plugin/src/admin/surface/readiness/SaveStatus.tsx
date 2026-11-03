'use client'
import { useRef, useState } from 'react'
import { Button } from '../../../ui/Button.js'
import type { TestDocApi } from '../contracts.js'
import { READINESS_COPY as C } from '../../copy/readiness.js'

export function SaveStatus({ test }: { test: TestDocApi }) {
  const inFlight = useRef(false)
  const [retrying, setRetrying] = useState(false)
  async function retry() {
    if (inFlight.current || test.preflightPending || test.hasUnsaved || test.saving === 'saving') return
    inFlight.current = true
    setRetrying(true)
    try { await test.refreshPreflight() } finally { inFlight.current = false; setRetrying(false) }
  }
  const message = test.saving === 'saving' ? C.saving : test.saving === 'saved' || test.saving === 'idle' ? C.saved : test.saving === 'error' && !test.stale ? C.saveError : null
  return <div className="xp-save-status" aria-live="polite">
    {message ? <span role={test.saving === 'error' ? 'alert' : 'status'}>{message}</span> : null}
    {test.preflightError ? <div><span role="alert">{C.checkError}</span>{' '}
      <span title={test.hasUnsaved || test.saving === 'saving' ? C.saveFirst : undefined}>
        <Button disabled={retrying || test.preflightPending || test.hasUnsaved || test.saving === 'saving'} onClick={() => { void retry() }}>{C.retry}</Button>
      </span></div> : null}
  </div>
}
