'use client'
import { surfaceUrls } from '../../surfaceUrls.js'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { formatAdminURL } from 'payload/shared'
import type { ResultsResponse } from '../../../types/endpoints.js'
import type { SectionProps } from '../contracts.js'
import { SurfaceShell } from '../SurfaceShell.js'
import { Button } from '../../../ui/Button.js'
import { Banner, StatusChip } from '../../../ui/Feedback.js'
import { createApi } from '../../api.js'
import { availableActions, actionGroupLabel } from '../../actions/actions.model.js'
import type { ActionDecision, ActionId } from '../../actions/actions.model.js'
import { AllocateAction, ConfirmAction } from '../readiness/ActionDialogs.js'
import { READINESS, daysRemaining, displayDate, nextStep, pageReadinessContext } from '../readiness/readiness.model.js'
import { READINESS_COPY as R, runningCopy, stoppedCopy, decidedCopy } from '../../copy/readiness.js'
import { RESULTS_COPY as C } from '../../copy/results.js'
import { TEST_PAGE } from '../../copy/testPage.js'
import type { ResultsPageParts } from './ResultsBody.js'

export function ResultsHeader({ test, surface, resultsVersion, children, actions, released }: SectionProps & ResultsPageParts) {
  const doc = test.doc!
  const [selected, setSelected] = useState<ActionId | null>(null)
  const [people, setPeople] = useState<number | null>(null)
  useEffect(() => {
    let active = true
    if (surface.canReadResults && doc.status === 'running') {
      void createApi(surface.apiRoute).summary([doc.id]).then(result => {
        const count = result.ok ? result.data?.[doc.id]?.exposures : undefined
        if (active && typeof count === 'number' && Number.isFinite(count)) setPeople(count)
      }).catch(() => { /* Retain the last successful summary while refreshing. */ })
    }
    return () => { active = false }
  }, [doc.id, doc.status, surface.apiRoute, surface.canReadResults, resultsVersion])
  const decision = doc.decision as ActionDecision | undefined
  const winner = actionGroupLabel(decision?.winnerArm ?? 'control', doc.arms.find(item => item.key === decision?.winnerArm)?.label)
  const available = availableActions({ status: doc.status, kind: doc.kind, arms: doc.arms, decision, canManage: surface.canManage })
    .filter(action => doc.status === 'running' ? ['allocate', 'stop'].includes(action.id) : action.id !== 'decide')
    .sort((a, b) => doc.status === 'running' ? ['allocate', 'stop'].indexOf(a.id) - ['allocate', 'stop'].indexOf(b.id) : 0)
  const next = nextStep(test.preflight, pageReadinessContext(doc, test.preflight, surface))
  const ready = Boolean(test.preflight && !test.preflightPending && !test.preflightError && test.preflight.checks.every(check => check.ok))
  const startReason = next?.sentence ?? (!ready ? test.preflightError ? R.checkError : R.checking : undefined)
  const action = available.find(item => item.id === selected)
  const sentence = doc.status === 'running' ? runningCopy(displayDate(doc.startedAt), people, daysRemaining(doc, Date.now()))
    : doc.status === 'stopped' ? stoppedCopy(displayDate(doc.stoppedAt))
      : doc.status === 'decided' ? decidedCopy(displayDate(doc.decidedAt), winner) : doc.status === 'archived' ? R.archived : null
  const testURL = formatAdminURL({ adminRoute: surface.adminRoute, path: `/experiments/${encodeURIComponent(String(doc.id))}` })
  return <SurfaceShell adminRoute={surface.adminRoute} title={doc.name}
    crumbs={[{ label: C.tests, href: surface.canManage ? surfaceUrls.home(surface.adminRoute) : undefined }, { label: doc.name, href: testURL }, { label: C.results }]}
    status={<><span className="xp-tests-kind">{TEST_PAGE.kinds[doc.kind]}</span><StatusChip status={doc.status} /></>}
    subtitle={<>{sentence ? <p role="status">{sentence}</p> : null}{released}
      {surface.canManage ? test.preflight?.checks.filter(check => check.code === 'make-content-unsupported' && check.warning).map((check, index) =>
        <Banner key={`${check.code}/${index}`} tone="warning">{READINESS[check.code].next(check.detail, doc)}</Banner>) : null}</>}
    actions={<div className="xp-ui-button-group"><Button variant="quiet" href={testURL}>{C.backToSetup}</Button>
      {available.map(item => <Button key={item.id} variant={item.tone === 'danger' ? 'danger' : 'secondary'}
        disabled={(item.id === 'start' && !!startReason) || !!selected || test.hasUnsaved || test.saving === 'saving' || (item.id === 'allocate' && doc.allocation >= 100)}
        title={item.id === 'start' ? startReason : item.id === 'allocate' && doc.allocation >= 100 ? R.everyone : undefined}
        onClick={() => setSelected(item.id)}>{item.id === 'allocate' ? R.allocate : item.label}</Button>)}{actions}</div>}>
    {test.errors._section ? <Banner tone="error">{test.errors._section}</Banner> : null}
    {test.preflightError ? <Banner tone="error">{test.preflightError}</Banner> : null}
    {children}
    {action?.id === 'allocate' ? <AllocateAction test={test} surface={surface} onClose={() => setSelected(null)} />
      : action ? <ConfirmAction test={test} surface={surface} action={action} winnerLabel={winner} onClose={() => setSelected(null)} /> : null}
  </SurfaceShell>
}

export function ReaderResultsShell({ surface, children, data }: { surface: SectionProps['surface']; children: ReactNode; data?: ResultsResponse }) {
  // CORE-48 sends a missing name as an empty string.
  const title = data?.experiment?.name?.trim() || C.test
  return <SurfaceShell adminRoute={surface.adminRoute} title={title}
    crumbs={[{ label: C.tests, href: surface.canManage ? surfaceUrls.home(surface.adminRoute) : undefined }, { label: title }, { label: C.results }]}>{children}</SurfaceShell>
}
