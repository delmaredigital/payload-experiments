'use client'
import { theme } from '../theme.js'

import type { DataQualityItem } from './results.model.js'
import { RESULTS_COPY } from '../copy/results.js'

export function DataQualityPanel({ items }: { items: DataQualityItem[] }) {
  if (items.length === 0) return null
  return <section className="xp-data-quality" aria-label={RESULTS_COPY.quality} style={{ color: theme.color.text, background: theme.color.surface, padding: '1rem' }}>
    <h2>{RESULTS_COPY.quality}</h2>
    <ul>{items.map(item => <li key={item.id}>
      <p>{item.message}</p>
      {item.detail ? <p>{item.detail}</p> : null}
      {item.shares ? <ul>{item.shares.map((share, index) => <li key={index}>{share}</li>)}</ul> : null}
      <p>{item.nextStep}</p>
    </li>)}</ul>
  </section>
}
