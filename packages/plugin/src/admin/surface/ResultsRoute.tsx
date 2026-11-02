'use client'

import type { DocId } from '../../types/contracts.js'
import type { SurfaceProps } from './contracts.js'
import { useTestDocument } from './useTestDocument.js'
import { TestHeader } from './test/TestHeader.js'
import { ResultsBody } from './results/ResultsBody.js'
import { TEST_PAGE as C } from '../copy/testPage.js'
import './test/testPage.css'

export function ResultsRoute(props: { id: DocId; surface: SurfaceProps }) {
  // Results-only readers cannot load the manager-only experiment or preflight.
  return props.surface.canManage ? <ManagedResults {...props} /> : <ResultsBody {...props} />
}

function ManagedResults({ id, surface }: { id: DocId; surface: SurfaceProps }) {
  const test = useTestDocument(id, { apiRoute: surface.apiRoute })
  // Add-goal changes metrics while status, phase and allocation stay the same.
  const bodyKey = test.doc ? JSON.stringify([test.doc.status, test.doc.phase, test.doc.allocation, test.doc.metrics]) : 'loading'
  // Shared DecideDialog reloads the page; Recompute keeps status; the surface Decide adapter refresh is owed.
  return <main className="xp-test-page">
    {test.loadState === 'ready' && test.doc ? <TestHeader test={test} surface={surface} view="results" />
      : <p role="status">{test.loadState === 'forbidden' ? C.forbidden : test.loadState === 'missing' ? C.missing : test.loadState === 'error' ? C.error : C.loading}</p>}
    {test.loadState === 'error' ? <button type="button" onClick={() => void test.reload()}>{C.retry}</button> : null}
    {test.errors._section ? <p role="alert">{test.errors._section}</p> : null}
    {test.preflightError ? <p role="alert">{test.preflightError}</p> : null}
    {test.loadState !== 'missing' && test.loadState !== 'forbidden' ? <ResultsBody key={bodyKey} id={id} surface={surface} /> : null}
  </main>
}
