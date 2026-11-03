'use client'
import { theme } from '../theme.js'

import type { DocId } from '../../types/contracts.js'
import type { PhaseSummary, ResultsResponse } from '../../types/endpoints.js'
import type { Snapshot } from '../../types/snapshot.js'
import { RESULTS_COPY as C, chartSummary, contentChangeTitle } from '../copy/results.js'
import { chartModel } from './chart.model.js'
import { formatDate } from '../format/date.js'
import { formatPercent } from './format.js'

const colors = [theme.color.textStrong, theme.color.textMuted, theme.color.borderAccent]

export function CiChart({ series, metricId, metricName, phase, contentChanges }: {
  series?: ResultsResponse['series']; metricId: DocId; metricName: string; phase: PhaseSummary
  contentChanges?: Snapshot['contentChanges']
}) {
  const model = chartModel({ series, metricId, phase, contentChanges })
  if (model.empty) return <p>{C.noHistory}</p>
  const [from, to] = model.xDomain, [low, high] = model.yDomain
  const x = (t: number) => 80 + (t - from) / (to - from) * 600
  const y = (value: number) => 230 - (value - low) / (high - low) * 210
  return <section className="xp-ci-chart" style={{ color: theme.color.text }}>
    <h2>{C.chart}</h2>
    <svg viewBox="0 0 760 280" style={{ width: '100%', height: 'auto' }} role="img"
      aria-label={chartSummary(metricName, model.variants.map(variant => variant.label).join(', '), formatDate(from), formatDate(to),
        [...new Set(model.markers.map(marker => formatDate(marker.t)))])}>
      <line x1={80} x2={680} y1={y(0)} y2={y(0)} stroke={theme.color.accent} strokeDasharray="4 4" />
      {[high, low].map((value, index) => <text key={index} x={72} y={y(value) + 4} textAnchor="end" fill="currentColor" fontSize={12}>{formatPercent(value, true)}</text>)}
      <text x={80} y={260} fill="currentColor" fontSize={12}>{formatDate(from)}</text>
      <text x={680} y={260} textAnchor="end" fill="currentColor" fontSize={12}>{formatDate(to)}</text>
      {model.variants.map((variant, index) => {
        const path = (points: Array<{ t: number; value: number | null }>) => {
          let connected = false
          return points.map(point => {
            if (point.value === null) { connected = false; return '' }
            const command = connected ? 'L' : 'M'
            connected = true
            return `${command}${x(point.t)},${y(point.value)}`
          }).join(' ')
        }
        const color = colors[index % colors.length]
        const upper = variant.points.map(point => `${x(point.t)},${y(point.hi ?? high)}`)
        const lower = [...variant.points].reverse().map(point => `${x(point.t)},${y(point.lo ?? low)}`)
        return <g key={variant.arm} data-series={variant.arm} stroke={color} fill={color}>
          <title>{variant.label}</title>
          <polygon points={[...upper, ...lower].join(' ')} fillOpacity={0.15} stroke="none" />
          <path d={path(variant.points.map(point => ({ t: point.t, value: point.lift })))} fill="none" strokeWidth={2} />
          {(['lo', 'hi'] as const).map(bound => <path key={bound} data-bound={bound}
            d={path(variant.points.map(point => ({ t: point.t, value: point[bound] })))} fill="none" strokeWidth={1} />)}
        </g>
      })}
      {model.markers.map((marker, index) => <g key={`${marker.at}/${index}`}>
        <title>{contentChangeTitle(formatDate(marker.t))}</title>
        <line x1={x(marker.t)} x2={x(marker.t)} y1={20} y2={230} stroke={theme.color.text} strokeDasharray="2 4" />
      </g>)}
    </svg>
    <ul>{model.variants.map((variant, index) => <li key={variant.arm} style={{ color: theme.color.text }}>
      <span aria-hidden="true" style={{ display: 'inline-block', width: '1em', height: '0.5em', marginRight: '0.5em', backgroundColor: colors[index % colors.length] }} />
      {variant.label}
    </li>)}</ul>
  </section>
}
