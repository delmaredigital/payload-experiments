'use client'

import { useEffect, useState } from 'react'
import type { DocId } from '../../types/contracts.js'
import type { SurfaceProps } from '../../testSurface/surface/contracts.js'
import { useTestDocument } from '../../testSurface/surface/useTestDocument.js'
import { ResultsHeader, ReaderResultsShell } from './results/ResultsHeader.js'
import { ResultsBody } from '../../testSurface/surface/results/ResultsBody.js'
import { TEST_PAGE as C } from '../../testSurface/copy/testPage.js'
import { Button } from '../../ui/Button.js'
import '../../testSurface/surface/test/testPage.css'

export function ResultsRoute(props: { id: DocId; surface: SurfaceProps; onTitleChange?: (title: string) => void }) {
  // Results-only readers cannot load the manager-only experiment or preflight.
  return props.surface.canManage ? <ManagedResults {...props} /> : <ResultsBody {...props} renderPage={({ children, data }) => <ReaderResultsShell surface={props.surface} data={data}>{children}</ReaderResultsShell>} />
}

function ManagedResults({ id, surface, onTitleChange }: { id: DocId; surface: SurfaceProps; onTitleChange?: (title: string) => void }) {
  const test = useTestDocument(id, { apiRoute: surface.apiRoute })
  useEffect(() => { if (test.doc?.name) onTitleChange?.(test.doc.name) }, [test.doc?.name, onTitleChange])
  const [resultsVersion, setResultsVersion] = useState(0)
  // Add-goal changes metrics while status, phase and allocation stay the same.
  const bodyKey = test.doc ? JSON.stringify([test.doc.status, test.doc.phase, test.doc.allocation, test.doc.metrics]) : 'loading'
  // ResultsBody's Decide is the shared DecideDialog, which reloads the page; Recompute keeps status.
  if (test.loadState === 'ready' && test.doc) return <ResultsBody key={bodyKey} id={id} surface={surface}
    onRecomputed={() => setResultsVersion(value => value + 1)} onPagesReleased={() => { void test.reload() }}
    renderPage={parts => <ResultsHeader key={`${test.doc!.id}/${test.doc!.status}`} test={test} surface={surface} resultsVersion={resultsVersion} {...parts} />} />
  return <ReaderResultsShell surface={surface}><div className="xp-test-page">
    <p role="status">{test.loadState === 'forbidden' ? C.forbidden : test.loadState === 'missing' ? C.missing : test.loadState === 'error' ? C.error : C.loading}</p>
    {test.loadState === 'error' ? <Button onClick={() => void test.reload()}>{C.retry}</Button> : null}
    {test.errors._section ? <p role="alert">{test.errors._section}</p> : null}
    {test.preflightError ? <p role="alert">{test.preflightError}</p> : null}
    {/* Wait for the header document so the body mounts once with its final key. */}
    {test.loadState !== 'loading' && test.loadState !== 'missing' && test.loadState !== 'forbidden' ? <ResultsBody key={bodyKey} id={id} surface={surface} onRecomputed={() => setResultsVersion(value => value + 1)} onPagesReleased={() => { void test.reload() }} /> : null}
  </div></ReaderResultsShell>
}
