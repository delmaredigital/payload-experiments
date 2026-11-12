'use client'
import type { ReactNode } from 'react'
import type { VerdictCardModel, guardrailChips } from './results.model.js'

export interface VerdictHeroProps { model: VerdictCardModel; guardrails?: ReturnType<typeof guardrailChips>; power?: string | null; collecting?: string | null; sinceShipping?: string | null; meta?: ReactNode; recommendation?: string }
import './results.css'

export function VerdictHero({ model, guardrails = [], power, collecting, sinceShipping, meta, recommendation }: VerdictHeroProps) {
  return <section className="xp-verdict-hero">
    {sinceShipping ? <p className="xp-since-shipping">{sinceShipping}</p> : null}
    <h2>{'title' in model ? model.title : model.headline}</h2>
    {'finding' in model && model.finding ? <p>{model.finding}</p> : null}
    {model.detail ? <p>{model.detail}</p> : null}
    {'guardrailLine' in model && model.guardrailLine ? <p>{model.guardrailLine}</p> : null}
    {!('title' in model) && collecting ? <p className="xp-collecting">{collecting}</p> : null}
    {recommendation ? <p className="xp-recommendation">{recommendation}</p> : null}
    {guardrails.length ? <ul className="xp-results-chips">{guardrails.map((item, index) =>
      <li className="xp-tests-kind" key={index}>{item.name}: {item.status}</li>)}</ul> : null}
    {!('title' in model) && power ? <p className="xp-power">{power}</p> : null}
    <div className="xp-verdict-meta">{meta}</div>
  </section>
}
