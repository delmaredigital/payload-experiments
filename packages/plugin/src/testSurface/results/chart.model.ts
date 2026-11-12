import type { DocId } from '../../types/contracts.js'
import type { PhaseSummary, ResultsResponse } from '../../types/endpoints.js'
import type { Snapshot } from '../../types/snapshot.js'

export interface ChartPoint { t: number; lift: number; lo: number | null; hi: number | null }
export type ChartModel = { empty: true } | {
  empty: false
  xDomain: [number, number]
  yDomain: [number, number]
  variants: Array<{ arm: string; label: string; points: ChartPoint[] }>
  markers: Array<{ t: number; at: string }>
}

/** Selects stored primary comparisons and display domains; performs no inference. */
export function chartModel({ series = [], metricId, phase, contentChanges = [] }: {
  series?: ResultsResponse['series']; metricId: DocId; phase: PhaseSummary
  contentChanges?: Snapshot['contentChanges']
}): ChartModel {
  const variants = phase.arms.filter(arm => arm.kind === 'variant').map(arm => ({
    arm: arm.key, label: arm.label,
    points: series.filter(point => point.metricId === metricId && point.arm === arm.key)
      .map(point => ({
        t: Date.parse(point.computedAt), lift: point.lift,
        lo: point.ci[0] !== null && Number.isFinite(point.ci[0]) ? point.ci[0] : null,
        hi: point.ci[1] !== null && Number.isFinite(point.ci[1]) ? point.ci[1] : null,
      })).filter(point => Number.isFinite(point.t) && Number.isFinite(point.lift))
      .sort((a, b) => a.t - b.t),
  })).filter(variant => variant.points.length > 0)
  const points = variants.flatMap(variant => variant.points)
  if (points.length < 2) return { empty: true }
  let from = points[0]!.t, to = from, low = 0, high = 0
  for (const point of points) {
    from = Math.min(from, point.t); to = Math.max(to, point.t)
    for (const value of [point.lift, point.lo, point.hi]) if (value !== null) {
      low = Math.min(low, value); high = Math.max(high, value)
    }
  }
  if (from === to) return { empty: true }
  return {
    empty: false, xDomain: [from, to], yDomain: low === high ? [-1, 1] : [low, high], variants,
    // Opaque editor ids never enter the chart model or its accessible text.
    markers: contentChanges.map(({ at }) => ({ t: Date.parse(at), at }))
      .filter(marker => Number.isFinite(marker.t) && marker.t >= from && marker.t <= to),
  }
}
