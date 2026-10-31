'use client'

import type { VerdictCardModel, guardrailChips } from './results.model.js'

export interface VerdictCardProps {
  model: VerdictCardModel
  guardrails?: ReturnType<typeof guardrailChips>
  power?: string | null
  collecting?: string | null
  sinceShipping?: string | null
}

export function VerdictCard({ model, guardrails = [], power, collecting, sinceShipping }: VerdictCardProps) {
  return <section className="xp-verdict-card" style={{ color: 'var(--theme-text)', background: 'var(--theme-elevation-50)', padding: '1rem' }}>
    {sinceShipping ? <p className="xp-since-shipping">{sinceShipping}</p> : null}
    <h2>{'title' in model ? model.title : model.headline}</h2>
    {'finding' in model && model.finding ? <p>{model.finding}</p> : null}
    {model.detail ? <p>{model.detail}</p> : null}
    {'guardrailLine' in model && model.guardrailLine ? <p>{model.guardrailLine}</p> : null}
    {!('title' in model) && collecting ? <p className="xp-collecting">{collecting}</p> : null}
    {guardrails.length > 0 ? <ul className="xp-guardrails">{guardrails.map((item, index) =>
      <li className="xp-chip" key={index}>{item.name}: {item.status}</li>,
    )}</ul> : null}
    {!('title' in model) && power ? <p className="xp-power">{power}</p> : null}
  </section>
}
