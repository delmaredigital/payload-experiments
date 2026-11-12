'use client'
import { useEffect, useRef } from 'react'
import type { ArmRow } from './results.model.js'

export interface DataTableProps { rows: ArmRow[]; caption: string; method: 'sequential' | 'bayesian'; metricKind: 'binomial' | 'count' | 'revenue' }
import { RESULTS_COPY as C } from '../copy/results.js'
import { CappedCell } from './CappedCell.js'
import './results.css'

export const seriesColor = (key: string) => key === 'variantA' ? 'var(--xp-series-a)' : key === 'variantB' ? 'var(--xp-series-b)' : key === 'variantC' ? 'var(--xp-series-c)' : 'var(--xp-series-muted)'
export function Swatch({ arm }: { arm: string }) { return <span className="xp-results-swatch" style={{ background: seriesColor(arm) }} aria-hidden="true" /> }

function updateScrollCues(wrap: HTMLDivElement) {
  wrap.parentElement?.classList.toggle('has-left', wrap.scrollLeft > 0)
  wrap.parentElement?.classList.toggle('has-right', wrap.scrollLeft + wrap.clientWidth < wrap.scrollWidth - 1)
}

export function DataTable({ rows, caption, metricKind, leader, primary = false }: DataTableProps & { leader?: string | null; primary?: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const wrap = scrollRef.current
    if (!wrap) return
    const update = () => updateScrollCues(wrap)
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(wrap)
    if (wrap.firstElementChild) observer?.observe(wrap.firstElementChild)
    window.addEventListener('resize', update)
    return () => { observer?.disconnect(); window.removeEventListener('resize', update) }
  }, [rows])
  return <div className="xp-data-table-frame"><div ref={scrollRef} className="xp-data-table-wrap" tabIndex={0} role="region" aria-label={caption}
    onScroll={event => updateScrollCues(event.currentTarget)}><table className="xp-data-table">
    <caption>{caption}</caption><thead><tr>
      <th scope="col">{C.group}</th><th scope="col" className="num">{C.people}</th>
      {primary && metricKind === 'binomial' ? <th scope="col" className="num">{C.conversions}</th> : null}
      <th scope="col" className="num">{metricKind === 'binomial' ? C.rate : C.average}</th>
      <th scope="col" className="num">{C.lift}</th><th scope="col" className="num">{C.ci}</th>
      {primary ? <th scope="col" className="num">{C.chanceToWin}</th> : null}
    </tr></thead><tbody>{rows.map(row => <tr key={row.key} className={primary && leader && row.key === leader ? 'is-lead' : undefined}>
      <th scope="row"><span className="xp-results-group"><Swatch arm={row.key} />{row.label}</span>{row.key === 'holdout' && row.baseline ? <div className="muted">{row.baseline}</div> : null}</th>
      <td className="num">{row.n}</td>
      {primary && metricKind === 'binomial' ? <td className="num">{row.value}</td> : null}
      <td className="num">{metricKind === 'revenue' ? <CappedCell model={{ ...row.capped, notice: undefined }} /> : row.rate ?? row.capped.statistic}</td>
      <td className={`num${row.baseline ? ' muted' : ''}`}>{row.baseline ? '—' : row.lift ?? '—'}</td>
      <td className={`num${row.baseline ? ' muted' : ''}`}>{row.baseline ? '—' : row.comparison?.method === 'sequential' ? row.comparison.adjustedCI ?? row.comparison.ci : row.comparison?.ci ?? '—'}</td>
      {primary ? <td className="num">{row.baseline ? '—' : row.chanceToWin ?? '—'}</td> : null}
    </tr>)}</tbody>
  </table></div></div>
}
