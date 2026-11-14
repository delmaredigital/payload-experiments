'use client'
import '../../../ui/ui.css'
import type { ReactNode } from 'react'
import { READINESS_COPY, moreBlockers } from '../../copy/readiness.js'

/** The footer and sidebar show the same bounded list, including other pages. */
export function BlockerList({ steps, renderSentence = step => step.sentence }: {
  steps: readonly { sentence: string }[]
  renderSentence?: (step: { sentence: string }, index: number) => ReactNode
}) {
  return steps.length ? <div className="xp-readiness__blockers" role="status"><strong>{READINESS_COPY.beforeStart}</strong><ul>
    {steps.slice(0, 3).map((step, index) => <li key={index}><span aria-hidden="true">⊗ </span>{renderSentence(step, index)}</li>)}
    {steps.length > 3 ? <li>{moreBlockers(steps.length - 3)}</li> : null}
  </ul></div> : null
}
