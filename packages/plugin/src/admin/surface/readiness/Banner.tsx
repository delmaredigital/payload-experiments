'use client'
import { useEffect, useState } from 'react'
import { Button } from '@payloadcms/ui'
import type { SectionProps } from '../contracts.js'
import type { ActionDecision, ActionId } from '../../actions/actions.model.js'
import { actionGroupLabel, availableActions } from '../../actions/actions.model.js'
import { createApi } from '../../api.js'
import { READINESS_COPY as C, decidedCopy, nextCopy, runningCopy, stoppedCopy } from '../../copy/readiness.js'
import { daysRemaining, displayDate, nextStep } from './readiness.model.js'
import { AddMetricAction, AllocateAction, ConfirmAction } from './ActionDialogs.js'
import { useTransition } from './useTransition.js'

const RUNNING_ACTIONS: readonly ActionId[] = ['stop', 'add-metric', 'allocate']

export function Banner(props: SectionProps) {
  return props.test.doc ? <BannerContent key={`${props.test.doc.id}/${props.test.doc.status}`} {...props} /> : null
}

function BannerContent({ test, surface }: SectionProps) {
  const [selected, setSelected] = useState<ActionId | null>(null)
  const [people, setPeople] = useState<number | null>(null)
  const transition = useTransition(test)
  const doc = test.doc!
  useEffect(() => {
    let active = true
    setPeople(null)
    if (surface.canReadResults && doc.status === 'running') {
      void createApi(surface.apiRoute).summary([doc.id]).then(result => {
        const count = result.ok ? result.data?.[doc.id]?.exposures : undefined
        if (active) setPeople(typeof count === 'number' && Number.isFinite(count) ? count : null)
      })
    }
    return () => { active = false }
  }, [doc.id, doc.status, surface.apiRoute, surface.canReadResults])
  const decision = doc.decision as ActionDecision | undefined
  const winner = actionGroupLabel(decision?.winnerArm ?? 'control', doc.arms.find(item => item.key === decision?.winnerArm)?.label)
  const next = nextStep(test.preflight, { ...doc, flagPoints: surface.flagPoints })
  const setup = doc.status === 'draft' || doc.status === 'stopped'
  const ready = Boolean(test.preflight && !test.preflightPending && !test.preflightError && test.preflight.checks.every(check => check.ok))
  const unsaved = test.hasUnsaved || test.saving === 'saving'
  const startReason = unsaved ? C.saveFirst : next?.sentence ?? (!ready ? test.preflightError ? C.checkError : C.checking : undefined)
  const actions = availableActions({ status: doc.status, kind: doc.kind, arms: doc.arms, decision, canManage: surface.canManage })
    .filter(action => setup ? action.id === 'start' : doc.status === 'running' ? RUNNING_ACTIONS.includes(action.id) : true)
    .sort((a, b) => doc.status === 'running' ? RUNNING_ACTIONS.indexOf(a.id) - RUNNING_ACTIONS.indexOf(b.id) : 0)
    .map(action => action.id === 'add-metric' ? { ...action, label: C.addMetric } : action.id === 'allocate' ? { ...action, label: C.allocate } : action)
  const action = actions.find(item => item.id === selected)
  const sentence = setup ? ready ? C.ready : next ? nextCopy(next.sentence) : test.preflightError ? C.checkError : C.checking
    : doc.status === 'running' ? runningCopy(displayDate(doc.startedAt), people, daysRemaining(doc, Date.now()))
      : doc.status === 'decided' ? decidedCopy(displayDate(doc.decidedAt), winner) : C.archived
  return <div className={`xp-readiness xp-readiness--${setup && ready ? 'ready' : 'neutral'}`}
    style={{ padding: '1rem', border: '1px solid var(--theme-elevation-200)', borderRadius: 'var(--style-radius-s)',
      background: setup && ready ? 'var(--theme-success-100)' : 'var(--theme-elevation-50)', color: 'var(--theme-text)' }}>
    <p role="status">{setup && next && !ready && next.section !== 'header' ? <a href={`#section-${next.section}`}>{sentence}</a> : sentence}</p>
    {doc.status === 'stopped' ? <p>{stoppedCopy(displayDate(doc.stoppedAt))}</p> : null}
    <div className="xp-readiness__actions" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
      {actions.map(item => {
        const reason = item.id === 'start' ? startReason : unsaved ? C.saveFirst : item.id === 'allocate' && doc.allocation >= 100 ? C.everyone : undefined
        const disabled = transition.busy || !!selected || !!reason
        return <span key={item.id} title={reason}>
          <Button buttonStyle={item.tone === 'primary' ? 'primary' : 'secondary'} disabled={disabled} onClick={() => {
            if (disabled) return
            if (item.id === 'start' && doc.status === 'draft') void transition.run(() => createApi(surface.apiRoute).start(doc.id))
            else setSelected(item.id)
          }}>{item.label}</Button>
        </span>
      })}
    </div>
    {transition.error ? <p role="alert">{transition.error}</p> : null}
    {action?.id === 'allocate' ? <AllocateAction test={test} surface={surface} onClose={() => setSelected(null)} />
      : action?.id === 'add-metric' ? <AddMetricAction test={test} surface={surface} onClose={() => setSelected(null)} />
        : action ? <ConfirmAction test={test} surface={surface} action={action} winnerLabel={winner} onClose={() => setSelected(null)} /> : null}
  </div>
}
