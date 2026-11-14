'use client'
import { useEffect, useState, useRef, type ReactNode } from 'react'
import type { DocId } from '../../../types/contracts.js'
import type { SurfaceProps, TestDocApi } from '../contracts.js'
import { useTestDocument } from '../useTestDocument.js'
import type { ReadinessRead } from '../../readinessRead.js'
import { TEST_PAGE as C } from '../../copy/testPage.js'
import { pageBlockParts } from '../pageBlock/parts.js'
import { settingParts } from '../setting/parts.js'
import { pageParts } from './pageParts.js'
import { Section } from './Section.js'
import { Hypothesis, TestName } from './fields.js'
import { VersionsSection } from './VersionsSection.js'
import { GoalSection } from './GoalSection.js'
import { TargetingSection } from './TargetingSection.js'
import { LengthSection } from './LengthSection.js'
import { AdvancedSection } from './AdvancedSection.js'
import { Button } from '../../../ui/Button.js'
import { Banner } from '../../../ui/Feedback.js'
import { Rail } from './Rail.js'
import { ReadinessBar } from './ReadinessBar.js'
import { ResultsBody } from '../results/ResultsBody.js'
import type { TestDocument } from '../testDocument.model.js'
import type { PreflightResult } from '../../../types/endpoints.js'
import { usePlacementNotice } from '../../../puck/editor/usePlacementNotice.js'
import { subscribePlacements, cachedPreflight, cachedReadinessRead, placementsPending, placementsBlocking, placementReadError } from '../../../puck/editor/placementsCache.js'
import { currentPuckDocument } from '../../../puck/editor/editor.model.js'
import { editorPlacementMessage, editorPreflight } from '../editorPlacement.js'
import './testPage.css'

export function TestSurface({ id, surface, onTitleChange, renderFrame, embedded = false, onDocument, onPreflight, requestPreflight }: {
  id: DocId; surface: SurfaceProps; onTitleChange?: (title: string) => void; embedded?: boolean
  renderFrame?: (content: { test: TestDocApi; children: ReactNode }) => ReactNode
  onDocument?: (doc: TestDocument) => void; onPreflight?: (preflight: PreflightResult) => void; requestPreflight?: (signal: AbortSignal, supersede?: boolean) => Promise<Response>
}) {
  const [barHeight, setBarHeight] = useState<number>()
  const documentState = useTestDocument(id, { apiRoute: surface.apiRoute, refetchPreflightOnFocus: true, ...(!surface.canManage ? { enabled: false } : {}), ...(onDocument ? { onDocument } : {}), ...(onPreflight ? { onPreflight } : {}), ...(requestPreflight ? { requestPreflight } : {}) })
  const [placementRead, setPlacementRead] = useState<{ key: string; preflight?: PreflightResult; pending: boolean; blocking: boolean; error?: string; read?: ReadinessRead }>()
  const placementKey = JSON.stringify([surface.apiRoute, String(id)])
  const watching = embedded && surface.canManage && documentState.loadState === 'ready'
  useEffect(() => {
    if (!embedded || !surface.canManage) return
    return subscribePlacements(surface.apiRoute, id, () => setPlacementRead({ key: placementKey,
      preflight: cachedPreflight(surface.apiRoute, id), read: cachedReadinessRead(surface.apiRoute, id), pending: placementsPending(surface.apiRoute, id), blocking: placementsBlocking(surface.apiRoute, id), error: placementReadError(surface.apiRoute, id) }))
  }, [surface.apiRoute, id, embedded, surface.canManage, placementKey])
  const currentRead = documentState.loadState === 'ready' && placementRead?.key === placementKey ? placementRead : undefined
  const preflight = currentRead ? currentRead.preflight ?? (currentRead.pending && !currentRead.error ? documentState.preflight : null) : documentState.preflight
  const sharedDocument = currentRead ? { ...documentState, preflight, preflightRead: currentRead.read,
    preflightPending: currentRead.pending || documentState.preflightPending,
    preflightError: !preflight ? currentRead.read?.message ?? null : null } : documentState
  const placementFailed = preflight?.checks.some(check => !check.ok && check.code === 'no-placements' && check.detail !== undefined)
  const lastPlacements = useRef<{ key: string; value: PreflightResult['placements'] } | undefined>(undefined)
  if (preflight?.placements && !placementFailed) lastPlacements.current = { key: placementKey, value: preflight.placements }
  const placements = !placementFailed && !sharedDocument.preflightError && lastPlacements.current?.key === placementKey ? lastPlacements.current.value : undefined
  const editorPage = embedded ? currentPuckDocument(window.location.pathname, surface.adminRoute, placements) ?? surface.editorPage : surface.editorPage
  const message = editorPlacementMessage(placements, editorPage, documentState.doc?.status)
  surface = { ...surface, editorPage, editorPlacementMessage: message }
  usePlacementNotice(surface.apiRoute, id, watching ? sharedDocument.preflightError ?? (placementFailed ? placementReadError(surface.apiRoute, id) : message) : undefined)
  const setup = documentState.doc?.status === 'draft' || documentState.doc?.status === 'stopped'
  const test = setup ? { ...sharedDocument, preflight: editorPreflight(preflight, surface) } : sharedDocument
  useEffect(() => { if (test.doc?.name) onTitleChange?.(test.doc.name) }, [test.doc?.name, onTitleChange])
  const frame = (body: ReactNode) => {
    const children = <div className="xp-test-surface">{body}</div>
    return renderFrame ? renderFrame({ test, children }) : children
  }
  // Results readers have no permission to load the manager-only test/preflight.
  if (!surface.canManage) return frame(<ResultsBody id={id} surface={surface} />)
  if (test.loadState !== 'ready' || !test.doc) return frame(<div className="xp-test-page" role={test.loadState === 'error' ? 'alert' : 'status'}>
    <p>{test.preflightRead?.message ?? (test.loadState === 'forbidden' ? C.forbidden : test.loadState === 'missing' ? C.missing : test.loadState === 'error' ? C.error : C.loading)}</p>
    {(test.preflightRead?.retry ?? test.loadState === 'error') ? <Button onClick={() => void test.reload()}>{C.retry}</Button> : null}
  </div>)
  const parts = test.doc.kind === 'block' ? pageBlockParts : test.doc.kind === 'page' ? pageParts : settingParts
  const props = { test, surface }
  return frame(
    <div className="xp-test-page xp-test-page--setup" style={{ paddingBottom: embedded || barHeight === undefined ? undefined : `${barHeight}px` }}>
    <div className="xp-test-layout"><Rail test={test} /><div className="xp-test-content">
    {test.errors._section ? <Banner tone="error" action={<Button onClick={() => void test.reload()}>{C.reload}</Button>}>{test.errors._section}</Banner> : null}
    <Section surface={surface} test={test} sectionId="what">
      <TestName {...props} /><parts.Binding {...props} /><Hypothesis {...props} />
    </Section>
    <VersionsSection {...props} parts={parts} contentOnCanvas={embedded} /><GoalSection {...props} embedded={embedded} /><TargetingSection {...props} />
    <LengthSection {...props} /><AdvancedSection {...props} />
    {embedded && surface.canReadResults && test.doc.status !== 'draft' ? <ResultsBody key={`${test.doc.id}/${test.doc.phase}/${test.doc.status}`} id={id} surface={surface} onChanged={doc => { test.acceptTransition?.({ doc }); void test.reload() }} /> : null}
    </div></div>
    <ReadinessBar {...props} onHeightChange={setBarHeight} />
  </div>)
}
