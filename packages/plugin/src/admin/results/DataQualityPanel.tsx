'use client'
import type { DataQualityItem } from './results.model.js'
import { RESULTS_COPY as C } from '../copy/results.js'
import './results.css'

const quality = (item: DataQualityItem) => item.id === 'srm' || item.id.startsWith('version-page-unavailable') ? 'problem' : 'watch'
export function DataQualityPanel({ items, problem = false }: { items: DataQualityItem[]; problem?: boolean }) {
  const overall = problem || items.some(item => quality(item) === 'problem') ? 'problem' : items.length ? 'watch' : 'ok'
  return <details className="xp-results-panel xp-data-quality" open={overall !== 'ok'}>
    <summary>{C.quality}<span className={`xp-quality-chip xp-quality-chip--${overall}`}>{C.qualityStates[overall]}</span></summary>
    <section aria-label={C.quality}>
      {items.length ? items.map(item => <div className="xp-quality-row" key={item.id}>
        <span className={`xp-quality-chip xp-quality-chip--${quality(item)}`}>{C.qualityStates[quality(item)]}</span>
        <p>{item.message}</p>{item.detail ? <p className="xp-quality-detail">{item.detail}</p> : null}
        {item.shares ? <ul>{item.shares.map((share, index) => <li key={index}>{share}</li>)}</ul> : null}
        <p className="xp-quality-next">{item.nextStep}</p>
      </div>) : <p className="xp-quality-row">{C.qualityOK}</p>}
    </section>
  </details>
}
