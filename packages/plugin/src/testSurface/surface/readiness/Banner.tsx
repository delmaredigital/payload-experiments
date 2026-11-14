'use client'
import { useEffect, useState } from 'react'
import { Button } from '../../../ui/Button.js'
import { SaveStatus, saveStatusMessage } from './SaveStatus.js'
import { jumpToSection } from '../test/jumpToSection.js'
import type { SectionId, SectionProps } from '../contracts.js'
import type { ActionDecision, ActionId } from '../../actions/actions.model.js'
import { actionGroupLabel, availableActions } from '../../actions/actions.model.js'
import { createApi } from '../../api.js'
import { TEST_PAGE } from '../../copy/testPage.js'
import { READINESS_COPY as C, moreBlockers, decidedCopy, fixFieldsNext, runningCopy, stoppedCopy } from '../../copy/readiness.js'
import { READINESS, daysRemaining, displayDate, blockingSteps, pageReadinessContext, errorSection } from './readiness.model.js'
import { AddMetricAction, AllocateAction, ConfirmAction } from './ActionDialogs.js'
import { preflightPlacementLabel } from '../../placements/placementLabels.js'
import { placementUncheckedCopy } from '../../copy/readiness.js'
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
  const labelledPreflight = test.preflight ? { ...test.preflight, checks: test.preflight.checks.map(check => check.code === 'placement-unchecked' ? { ...check, detail: { ...check.detail as object, title: preflightPlacementLabel(check.detail, test.preflight!, surface.adminRoute).title } } : check) } : null
  const readinessBlockers = blockingSteps(labelledPreflight, pageReadinessContext(doc, test.preflight, surface))
  const setup = doc.status === 'draft' || doc.status === 'stopped'
  const ready = Boolean(test.preflight && !test.preflightPending && !test.preflightError && test.preflight.checks.every(check => check.ok))
  const unsaved = test.hasUnsaved || test.saving === 'saving'
  const blockers: Array<{ section: SectionId | 'header'; sentence: string; code: string; arm?: string }> = [...readinessBlockers]
  if (unsaved && !test.stale) blockers.unshift({ section: 'header', sentence: C.saveFirst, code: 'unsaved' })
  else if (test.preflightError) blockers.unshift({ section: 'header', sentence: C.checkError, code: 'readiness-error' })
  else if (test.preflightPending || !test.preflight) blockers.unshift({ section: 'header', sentence: C.checking, code: 'checking' })
  const errorSections = [...new Set(Object.keys(test.errors).filter(path => path !== '_section').map(path => errorSection(path) ?? 'what'))]
  for (const section of errorSections.reverse()) blockers.unshift({ section, sentence: test.stale ? C.reloadFirst : fixFieldsNext(TEST_PAGE.sections[section]), code: `validation:${section}` })
  if (test.errors._section || test.stale) blockers.unshift({ section: 'what', sentence: test.stale ? C.reloadFirst : C.reloadAfterError, code: 'save-error' })
  const startReason = blockers[0]?.sentence ?? (!ready ? C.checking : undefined)
  const actions = availableActions({ status: doc.status, kind: doc.kind, arms: doc.arms, decision, canManage: surface.canManage })
    .filter(action => setup ? action.id === 'start' : doc.status === 'running' ? RUNNING_ACTIONS.includes(action.id) : true)
    .sort((a, b) => doc.status === 'running' ? RUNNING_ACTIONS.indexOf(a.id) - RUNNING_ACTIONS.indexOf(b.id) : 0)
    .map(action => action.id === 'add-metric' ? { ...action, label: C.addGoal } : action.id === 'allocate' ? { ...action, label: C.allocate } : action)
  const action = actions.find(item => item.id === selected)
  const sentence = transition.busy ? C.changing : setup ? ready && !blockers.length ? C.ready : null
    : doc.status === 'running' ? runningCopy(displayDate(doc.startedAt), people, daysRemaining(doc, Date.now()))
      : doc.status === 'decided' ? decidedCopy(displayDate(doc.decidedAt), winner) : C.archived
  return <div className={`xp-readiness xp-readiness--${setup && ready && !blockers.length && !transition.busy ? 'ready' : 'neutral'}${bar ? ' xp-readiness--bar xp-tests-container' : ''}`}>
    {setup && test.preflight?.checks.some(check => check.code === 'page-targets-unchecked' && check.warning) ? <p>{C.uncheckedPages}</p> : null}
    {test.preflight?.checks.filter(check => check.code === 'make-content-unsupported' && check.warning).map(check => <p key={check.code}>{READINESS[check.code].next(check.detail, doc)}</p>)}
    {test.preflight?.checks.filter(check => check.warning && ['goal-in-some-versions', 'placement-unchecked'].includes(check.code)).map((check, index) => {
      const placement = check.code === 'placement-unchecked' ? preflightPlacementLabel(check.detail, test.preflight!, surface.adminRoute) : undefined
      return <p key={`${check.code}:${index}`}>{placement ? placement.href ? <a href={placement.href}>{placementUncheckedCopy(placement.title)}</a> : placementUncheckedCopy(placement.title) : READINESS[check.code].next(check.detail, doc)}</p>
    })}
    {[...new Map(test.preflight?.goalNotes?.map(note => [String(note.metricId), note])).values()].map(note => <p className="xp-readiness__warning" key={note.metricId}><span aria-hidden="true">⚠ </span>{note.message}</p>)}
    {doc.status === 'stopped' ? <p>{stoppedCopy(displayDate(doc.stoppedAt))}</p> : null}
    <div className="xp-readiness__state">
      {bar ? <><SaveStatus test={test} />{sentence && (saveStatusMessage(test) || test.preflightError) ? <span className="xp-readiness__separator" aria-hidden="true">·</span> : null}</> : null}
      {sentence ? <p role="status">{sentence}</p> : null}
      {setup && blockers.length ? <div className="xp-readiness__blockers" role="status"><strong>{C.beforeStart}</strong><ul>
        {blockers.slice(0, 3).map((step, index) => <li key={`${step.code}-${index}`}><span aria-hidden="true">⊗ </span>{step.section === 'header' ? step.sentence : <a href={`#section-${step.section}`} onClick={event => {
          event.preventDefault(); if (step.section !== 'header') jumpToSection(step.section, step.arm)
        }}>{step.sentence}</a>}</li>)}
        {blockers.length > 3 ? <li>{moreBlockers(blockers.length - 3)}</li> : null}
      </ul></div> : null}
    </div>
    <div className="xp-readiness__actions">
      {actions.map(item => {
        const reason = item.id === 'start' ? startReason : test.stale ? C.reloadFirst : unsaved ? C.saveFirst : item.id === 'allocate' && doc.allocation >= 100 ? C.everyone : undefined
        const disabled = transition.busy || !!selected || !!reason
        return <span key={item.id} title={reason}>
          {reason && item.id !== 'start' ? <span className="xp-readiness-action-reason">{reason}</span> : null}
          <Button busy={transition.busy} variant={item.tone === 'primary' || (bar && item.id === 'stop') ? 'primary' : 'secondary'} disabled={disabled} onClick={() => {
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
