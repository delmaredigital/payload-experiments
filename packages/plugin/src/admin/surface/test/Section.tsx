'use client'
import type { ReactNode } from 'react'
import type { SectionId, TestDocApi } from '../contracts.js'
import { readinessParts } from '../readiness/parts.js'
import { SectionCard } from '../../../ui/SectionCard.js'
import { SECTION_ORDER } from '../contracts.js'
import { TEST_PAGE as C } from '../../copy/testPage.js'

export function Section({ test, sectionId, children }: { test: TestDocApi; sectionId: SectionId; children: ReactNode }) {
  const done = readinessParts.sectionDone(test)[sectionId]
  if (sectionId === 'advanced') return <details className="xp-test-advanced" id="section-advanced">
    <summary><h2 id="title-advanced" tabIndex={-1}>{C.sections.advanced}</h2>
      <span aria-label={done ? C.complete : C.incomplete}>{done ? C.completeMark : C.incompleteMark}</span></summary>
    <div className="xp-ui-section-body">{children}</div>
  </details>
  return <SectionCard number={SECTION_ORDER.indexOf(sectionId) + 1} title={C.sections[sectionId]} complete={done}
    id={`section-${sectionId}`} headingId={`title-${sectionId}`} className="xp-test-section">{children}</SectionCard>
}
