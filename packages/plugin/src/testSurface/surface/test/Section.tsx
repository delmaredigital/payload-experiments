'use client'
import { useState, type ReactNode } from 'react'
import type { SectionId, TestDocApi } from '../contracts.js'
import { blockingSteps, pageReadinessContext, sectionBlocked } from '../readiness/readiness.model.js'
import type { SurfaceProps } from '../contracts.js'
import { readinessParts } from '../readiness/parts.js'
import { SectionCard } from '../../../ui/SectionCard.js'
import { SECTION_ORDER } from '../contracts.js'
import { fixFieldsNext } from '../../copy/readiness.js'
import { TEST_PAGE as C } from '../../copy/testPage.js'

export function Section({ test, sectionId, children, surface }: { test: TestDocApi; sectionId: SectionId; children: ReactNode; surface?: SurfaceProps }) {
  const hasAdvancedError = Object.keys(test.errors).some(path => path.startsWith('analysis.') && !['analysis.reachPerDay', 'analysis.plannedDurationDays'].includes(path) || path === 'exposurePolicy')
  const [open, setOpen] = useState(hasAdvancedError)
  const [prevHasAdvancedError, setPrevHasAdvancedError] = useState(hasAdvancedError)
  if (hasAdvancedError !== prevHasAdvancedError) {
    setPrevHasAdvancedError(hasAdvancedError)
    if (hasAdvancedError) setOpen(true)
  }
  const setup = test.doc?.status === 'draft' || test.doc?.status === 'stopped'
  const blocked = setup && sectionBlocked(test, sectionId)
  const blockers = setup && test.doc ? blockingSteps(test.preflight, surface ? pageReadinessContext(test.doc, test.preflight, surface) : test.doc).filter(step => step.section === sectionId) : []
  const done = readinessParts.sectionDone(test)[sectionId]
  const blockerLines = blockers.map((step, index) => <p className="xp-ui-error xp-test-blocker" key={`${step.code}-${index}`}><span aria-hidden="true">⊗ </span>{step.sentence}</p>)
  if (setup && sectionId === 'advanced' && hasAdvancedError) blockerLines.push(<p className="xp-ui-error xp-test-blocker" key="advanced-validation"><span aria-hidden="true">⊗ </span>{fixFieldsNext(C.sections.advanced)}</p>)
  if (sectionId === 'advanced') return <details open={open} onToggle={event => setOpen(event.currentTarget.open)} className={`xp-test-advanced${blocked ? ' xp-ui-section--blocked' : ''}`} id="section-advanced">
    <summary><h2 id="title-advanced" tabIndex={-1}>{C.sections.advanced}</h2></summary>
    <div className="xp-ui-section-body">{children}{blockerLines}</div>
  </details>
  return <SectionCard number={SECTION_ORDER.indexOf(sectionId) + 1} title={C.sections[sectionId]} complete={done} blocked={blocked}
    id={`section-${sectionId}`} headingId={`title-${sectionId}`} className="xp-test-section">{children}{blockerLines}</SectionCard>
}
