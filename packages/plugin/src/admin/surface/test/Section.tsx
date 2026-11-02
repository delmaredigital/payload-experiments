'use client'
import type { ReactNode } from 'react'
import type { SectionId, TestDocApi } from '../contracts.js'
import { readinessParts } from '../readiness/parts.js'
import { TEST_PAGE as C } from '../../copy/testPage.js'

export function Section({ test, sectionId, children }: { test: TestDocApi; sectionId: SectionId; children: ReactNode }) {
  const done = readinessParts.sectionDone(test)[sectionId]
  return <section className="xp-test-section" id={`section-${sectionId}`} aria-labelledby={`title-${sectionId}`}>
    <h2 id={`title-${sectionId}`}><span className={done ? 'xp-section-check xp-section-check--done' : 'xp-section-check'} aria-label={done ? C.complete : C.incomplete}>{done ? C.completeMark : C.incompleteMark}</span>{' '}{C.sections[sectionId]}</h2>
    {children}
  </section>
}
