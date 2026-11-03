'use client'
import { theme } from '../theme.js'

import type { CappedCellModel } from './results.model.js'

export function CappedCell({ model }: { model: CappedCellModel }) {
  return <div className="xp-capped-cell" style={{ color: theme.color.text }}>
    <span>{model.statistic}</span>
    {model.totalLine ? <div>{model.totalLine}</div> : null}
    {model.cappedLine ? <div>{model.cappedLine}</div> : null}
    {model.notice ? <p>{model.notice}</p> : null}
  </div>
}
