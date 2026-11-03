'use client'

import { useEffect, useState } from 'react'
import type { DocId } from '../../types/contracts.js'
import type { SurfaceProps } from './contracts.js'
import { useTestDocument } from './useTestDocument.js'
import { TestHeader } from './test/TestHeader.js'
import { ResultsBody } from './results/ResultsBody.js'
import { TEST_PAGE as C } from '../copy/testPage.js'
import './test/testPage.css'

export function ResultsRoute(props: { id: DocId; surface: SurfaceProps; onTitleChange?: (title: string) => void }) {
  // Results-only readers cannot load the manager-only experiment or preflight.
  return props.surface.canManage ? <ManagedResults {...props} /> : <ResultsBody {...props} />
}

function ManagedResults({ id, surface, onTitleChange }: { id: DocId; surface: SurfaceProps; onTitleChange?: (title: string) => void }) {
  const test = useTestDocument(id, { apiRoute: surface.apiRoute })
  useEffect(() => { if (test.doc?.name) onTitleChange?.(test.doc.name) }, [test.doc?.name, onTitleChange])
  const [resultsVersion, setResultsVersion] = useState(0)
  // Add-goal changes metrics while status, phase and allocation stay the same.
  const bodyKey = test.doc ? JSON.stringify([test.doc.status, test.doc.phase, test.doc.allocation, test.doc.metrics]) : 'loading'
  // ResultsBody's Decide is the shared DecideDialog, which reloads the page; Recompute keeps status.
  return <div className="xp-test-page">
    {test.loadState === 'ready' && test.doc ? <TestHeader test={test} surface={surface} view="results" resultsVersion={resultsVersion} />
      : <p role="status">{test.loadState === 'forbidden' ? C.forbidden : test.loadState === 'missing' ? C.missing : test.loadState === 'error' ? C.error : C.loading}</p>}
    {test.loadState === 'error' ? <button type="button" onClick={() => void test.reload()}>{C.retry}</button> : null}
    {test.errors._section ? <p role="alert">{test.errors._section}</p> : null}
    {test.preflightError ? <p role="alert">{test.preflightError}</p> : null}
    {/* Wait for the header document so the body mounts once with its final key. */}
    {test.loadState !== 'loading' && test.loadState !== 'missing' && test.loadState !== 'forbidden' ? <ResultsBody key={bodyKey} id={id} surface={surface} onRecomputed={() => setResultsVersion(value => value + 1)} /> : null}
  </div>
}
