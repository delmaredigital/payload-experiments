'use client'

import { Button } from '@payloadcms/ui'
import type { MakeContentResult as Result } from '../../types/endpoints.js'
import { ACTIONS_COPY as C } from '../copy/actions.js'

export function MakeContentResult({ result, onRetry, busy = false }: { result: Result; onRetry: () => void; busy?: boolean }) {
  const failed = result.docs.some(doc => !doc.ok)
  return <div aria-live="polite">
    <ul>{result.docs.map((doc, index) => <li key={`${doc.collection}/${doc.id}/${index}`}>
      {('title' in doc && typeof doc.title === 'string' && doc.title) || `${doc.collection}/${doc.id}`}: {doc.ok ? C.updated : C.failed}
      {doc.error ? ` — ${doc.error}` : ''}
    </li>)}</ul>
    {failed ? <><p>{C.partial}</p><Button disabled={busy} onClick={onRetry}>{C.retry}</Button></> : null}
  </div>
}
