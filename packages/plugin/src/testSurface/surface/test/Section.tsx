'use client'
import { useState, type ReactNode } from 'react'
import type { SectionId, TestDocApi } from '../contracts.js'
import { readinessParts } from '../readiness/parts.js'
import { SectionCard } from '../../../ui/SectionCard.js'
import { SECTION_ORDER } from '../contracts.js'
import { TEST_PAGE as C } from '../../copy/testPage.js'

export function Section({ test, sectionId, children }: { test: TestDocApi; sectionId: SectionId; children: ReactNode }) {
  const hasAdvancedError = Object.keys(test.errors).some(path => path.startsWith('analysis.') && !['analysis.reachPerDay', 'analysis.plannedDurationDays'].includes(path) || path === 'exposurePolicy')
  const [open, setOpen] = useState(hasAdvancedError)
  const [prevHasAdvancedError, setPrevHasAdvancedError] = useState(hasAdvancedError)
  if (hasAdvancedError !== prevHasAdvancedError) {
    setPrevHasAdvancedError(hasAdvancedError)
    if (hasAdvancedError) setOpen(true)
  }
  const done = readinessParts.sectionDone(test)[sectionId]
  if (sectionId === 'advanced') return <details open={open} onToggle={event => setOpen(event.currentTarget.open)} className="xp-test-advanced" id="section-advanced">
    <summary><h2 id="title-advanced" tabIndex={-1}>{C.sections.advanced}</h2></summary>
    <div className="xp-ui-section-body">{children}</div>
  </details>
  return <SectionCard number={SECTION_ORDER.indexOf(sectionId) + 1} title={C.sections[sectionId]} complete={done}
    id={`section-${sectionId}`} headingId={`title-${sectionId}`} className="xp-test-section">{children}</SectionCard>
}
