'use client'
import { useEffect, useState } from 'react'
import { Button } from '../../../ui/Button.js'
import { SaveStatus, saveStatusMessage } from './SaveStatus.js'
import { jumpToSection } from '../test/jumpToSection.js'
import type { SectionProps } from '../contracts.js'
import type { ActionDecision, ActionId } from '../../actions/actions.model.js'
import { actionGroupLabel, availableActions } from '../../actions/actions.model.js'
import { createApi } from '../../api.js'
import { READINESS_COPY as C, decidedCopy, nextCopy, runningCopy, stoppedCopy } from '../../copy/readiness.js'
import { READINESS, daysRemaining, displayDate, nextStep } from './readiness.model.js'
import { AddMetricAction, AllocateAction, ConfirmAction } from './ActionDialogs.js'
import { useTransition } from './useTransition.js'

const RUNNING_ACTIONS: readonly ActionId[] = ['stop', 'add-metric', 'allocate']

export function Banner(props: SectionProps) {
  return props.test.doc ? <ReadinessContent key={`${props.test.doc.id}/${props.test.doc.status}`} {...props} /> : null
}

export function ReadinessContent({ test, surface, resultsVersion, bar = false }: SectionProps & { bar?: boolean }) {
  const [selected, setSelected] = useState<ActionId | null>(null)
  const [people, setPeople] = useState<number | null>(null)
  const transition = useTransition(test)
  const doc = test.doc!
  useEffect(() => {
    let active = true
    // The id/status key resets the count; refreshes retain it while loading.
    if (surface.canReadResults && doc.status === 'running') {
      void Promise.resolve().then(() => active ? createApi(surface.apiRoute).summary([doc.id]) : undefined).then(result => {
        if (!result?.ok) return
        const count = result.data?.[doc.id]?.exposures
        if (active) setPeople(typeof count === 'number' && Number.isFinite(count) ? count : null)
      }).catch(() => { /* Keep the last successful count when a refresh fails. */ })
    }
    return () => { active = false }
  }, [doc.id, doc.status, surface.apiRoute, surface.canReadResults, resultsVersion])
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
    .map(action => action.id === 'add-metric' ? { ...action, label: C.addGoal } : action.id === 'allocate' ? { ...action, label: C.allocate } : action)
  const action = actions.find(item => item.id === selected)
  const sentence = setup ? bar && test.preflightError ? null : ready ? C.ready : next ? nextCopy(next.sentence) : test.preflightError ? C.checkError : C.checking
    : doc.status === 'running' ? runningCopy(displayDate(doc.startedAt), people, daysRemaining(doc, Date.now()))
      : doc.status === 'decided' ? decidedCopy(displayDate(doc.decidedAt), winner) : C.archived
  return <div className={`xp-readiness xp-readiness--${setup && ready ? 'ready' : 'neutral'}${bar ? ' xp-readiness--bar xp-tests-container' : ''}`}>
    <div className="xp-readiness__state">
      {bar ? <><SaveStatus test={test} />{sentence && (saveStatusMessage(test) || test.preflightError) ? <span className="xp-readiness__separator" aria-hidden="true">·</span> : null}</> : null}
      {sentence ? <p role="status">{setup && next && !ready && next.section !== 'header' ? <a href={`#section-${next.section}`} onClick={event => {
        event.preventDefault()
        if (next.section !== 'header') jumpToSection(next.section)
      }}>{sentence}</a> : sentence}</p> : null}
    </div>
    {setup && test.preflight?.checks.some(check => check.code === 'page-targets-unchecked' && check.warning) ? <p>{C.uncheckedPages}</p> : null}
    {test.preflight?.checks.filter(check => check.code === 'make-content-unsupported' && check.warning).map(check => <p key={check.code}>{READINESS[check.code].next(check.detail, doc)}</p>)}
    {doc.status === 'stopped' ? <p>{stoppedCopy(displayDate(doc.stoppedAt))}</p> : null}
    <div className="xp-readiness__actions">
      {actions.map(item => {
        const reason = item.id === 'start' ? startReason : unsaved ? C.saveFirst : item.id === 'allocate' && doc.allocation >= 100 ? C.everyone : undefined
        const disabled = transition.busy || !!selected || !!reason
        return <span key={item.id} title={reason}>
          <Button variant={item.tone === 'primary' || (bar && item.id === 'stop') ? 'primary' : 'secondary'} disabled={disabled} onClick={() => {
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
