'use client'
import { READINESS_COPY } from '../../testSurface/copy/readiness.js'
import { canStartTest, readyToStart } from '../../testSurface/readinessRead.js'
import { useState } from 'react'
import { Button } from '../../ui/Button.js'
import type { SectionProps } from '../../testSurface/surface/contracts.js'
import { availableActions } from '../../testSurface/actions/actions.model.js'
import { ConfirmAction } from '../../testSurface/surface/readiness/ActionDialogs.js'
import { useTransition } from '../../testSurface/surface/readiness/useTransition.js'
import { createApi } from '../../testSurface/api.js'

/** Same transition runner and confirmation as the drawer; Decide stays there. */
export function QuickTestActions({ test, surface }: SectionProps) {
  const [confirm, setConfirm] = useState(false)
  const transition = useTransition(test)
  const doc = test.doc!
  const action = availableActions({ ...doc, canManage: surface.canManage }).find(item =>
    doc.status === 'draft' ? item.id === 'start' : doc.status === 'running' && item.id === 'stop')
  if (!action) return null
  const ready = !transition.checking && canStartTest(test, surface.editorPlacementMessage)
  const showAction = action.id !== 'start' || readyToStart(test, surface.editorPlacementMessage) && !test.hasUnsaved
  return <>
    {showAction && action.id === 'start' ? <p role="status">{READINESS_COPY.ready}</p> : null}
    {showAction ? <Button disabled={transition.busy || confirm || test.hasUnsaved || action.id === 'start' && !ready} busy={transition.busy} onClick={() => {
      if (action.id === 'start') void transition.run(() => createApi(surface.apiRoute).start(doc.id))
      else setConfirm(true)
    }}>{action.label}</Button> : null}
    {transition.error ? <p role="alert">{transition.error}</p> : null}
    {confirm ? <ConfirmAction test={test} surface={surface} action={action} winnerLabel="" onClose={() => setConfirm(false)} /> : null}
  </>
}
