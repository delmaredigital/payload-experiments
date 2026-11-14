'use client'
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
  const ready = test.preflight && !test.preflightError && !test.preflightPending && test.preflight.checks?.every(check => check.ok) && !surface.editorPlacementMessage
  const showAction = action.id !== 'start' || ready && !test.hasUnsaved
  return <>
    {showAction ? <Button disabled={transition.busy || confirm || test.hasUnsaved} busy={transition.busy} onClick={() => {
      if (action.id === 'start') void transition.run(() => createApi(surface.apiRoute).start(doc.id))
      else setConfirm(true)
    }}>{action.label}</Button> : null}
    {transition.error ? <p role="alert">{transition.error}</p> : null}
    {confirm ? <ConfirmAction test={test} surface={surface} action={action} winnerLabel="" onClose={() => setConfirm(false)} /> : null}
  </>
}
