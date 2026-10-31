'use client'

import type { ArmRow } from './results.model.js'
import { RESULTS_COPY } from '../copy/results.js'
import { CappedCell } from './CappedCell.js'

export interface ArmTableProps {
  rows: ArmRow[]
  caption: string
  method: 'sequential' | 'bayesian'
  metricKind: 'binomial' | 'count' | 'revenue'
  showAdjusted?: boolean
}

export function ArmTable({ rows, caption, method, metricKind, showAdjusted = false }: ArmTableProps) {
  const sequential = method === 'sequential'
  const columns = sequential ? showAdjusted ? 5 : 4 : 4
  return <div className="xp-arm-table" style={{ color: 'var(--theme-text)', overflowX: 'auto' }}>
    <table>
      <caption>{caption}</caption>
      <thead><tr>
        <th scope="col">{RESULTS_COPY.group}</th>
        <th scope="col">{RESULTS_COPY.people}</th>
        <th scope="col">{metricKind === 'binomial' ? RESULTS_COPY.conversions : RESULTS_COPY.mean}</th>
        <th scope="col">{sequential ? RESULTS_COPY.lift : RESULTS_COPY.chanceToWin}</th>
        <th scope="col">{RESULTS_COPY.ci}</th>
        {sequential && showAdjusted ? <th scope="col">{RESULTS_COPY.adjustedCI}</th> : null}
        <th scope="col">{sequential ? RESULTS_COPY.pValue : RESULTS_COPY.risk}</th>
        <th scope="col">{RESULTS_COPY.comparison}</th>
      </tr></thead>
      <tbody>{rows.map(row => <tr key={row.key}>
        <th scope="row">{row.label}</th>
        <td>{row.n}</td>
        <td>{metricKind === 'revenue' ? <CappedCell model={row.capped} /> : row.value}</td>
        {row.baseline ? <td colSpan={columns}>{row.baseline}</td> : <>
          <td>{row.comparison?.method === 'sequential' ? row.comparison.lift : row.comparison?.chanceToWin ?? '—'}</td>
          <td>{row.comparison?.ci ?? '—'}</td>
          {sequential && showAdjusted ? <td>{row.comparison?.method === 'sequential' ? row.comparison.adjustedCI ?? '—' : '—'}</td> : null}
          <td>{row.comparison?.method === 'sequential' ? row.comparison.pValue : row.comparison?.risk ?? '—'}</td>
          <td>{row.comparison ? <span className="xp-chip">{row.comparison.significance}</span> : '—'}</td>
        </>}
      </tr>)}</tbody>
    </table>
  </div>
}
