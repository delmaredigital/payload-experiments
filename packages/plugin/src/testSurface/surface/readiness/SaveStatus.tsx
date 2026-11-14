'use client'
import { useRef, useState } from 'react'
import { Button } from '../../../ui/Button.js'
import type { TestDocApi } from '../contracts.js'
import { READINESS_COPY as C } from '../../copy/readiness.js'

export function saveStatusMessage(test: TestDocApi): string | null {
  return test.saving === 'saving' ? C.saving : test.saving === 'saved' || test.saving === 'idle' ? C.saved : test.saving === 'error' && !test.stale ? test.errors._section ? C.saveGeneralError : C.saveError : null
}

export function SaveStatus({ test }: { test: TestDocApi }) {
  const inFlight = useRef(false)
  const [retrying, setRetrying] = useState(false)
  async function retry() {
    if (inFlight.current || test.preflightPending || test.hasUnsaved || test.saving === 'saving') return
    inFlight.current = true
    setRetrying(true)
    try { await test.refreshPreflight() } finally { inFlight.current = false; setRetrying(false) }
  }
  const message = saveStatusMessage(test)
  return <div className="xp-save-status" aria-live="polite">
    {message ? <span role={test.saving === 'error' ? 'alert' : 'status'}>{message}</span> : null}
    {test.preflightError ? <div><span role="alert">{test.preflightError}</span>{' '}
      {test.hasUnsaved || test.saving === 'saving' ? <p>{test.stale ? C.reloadFirst : C.saveFirst}</p> : test.preflightPending || retrying ? <p>{C.checking}</p> : null}
      <span title={test.stale ? C.reloadFirst : test.hasUnsaved || test.saving === 'saving' ? C.saveFirst : undefined}>
        <Button disabled={retrying || test.preflightPending || test.hasUnsaved || test.saving === 'saving'} onClick={() => { void retry() }}>{C.retry}</Button>
      </span></div> : null}
  </div>
}
