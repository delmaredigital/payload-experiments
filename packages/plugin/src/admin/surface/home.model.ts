import type { Arm, DocId, ExperimentKind, Status, UnitType } from '../../types/contracts.js'
import { formatAdminURL } from 'payload/shared'
import type { SummaryResponse } from '../../types/endpoints.js'
import { armLabel } from '../labels.js'
import { statusPill } from '../status.model.js'
import { decidedLine, runningLine, SURFACE_COPY } from '../copy/surface.js'
import { nextCopy } from '../copy/readiness.js'
import { READINESS } from './readiness/readiness.model.js'
import type { ReadinessContext } from './readiness/readiness.model.js'
import { sanitizeReadinessDetail } from '../../sanitizeReadinessDetail.js'

export interface HomeTest {
  id: DocId; name: string; kind: ExperimentKind; status: Status; unitType: UnitType
  flagPoint?: string | null
  analysis?: { plannedDurationDays?: number | null } | null
  arms?: Arm[] | null
  decidedAt?: string | null
  decision?: { winnerArm?: string | null; holdoutReleasedAt?: string | null } | null
}
type Summary = SummaryResponse[DocId] | undefined
export type Health = 'red' | 'amber' | 'green'
export function healthDot(test: HomeTest, summary: Summary): Health | undefined {
  const code = summary?.verdict?.code
  if (summary?.health?.some(item => item.code === 'version-page-unavailable') || code === 'data-problem' || code === 'guardrail-failing') return 'red'
  if (summary?.health?.length || code === 'unavailable' || code === 'collecting' && test.analysis?.plannedDurationDays != null
    && summary!.days > test.analysis.plannedDurationDays) return 'amber'
  return code ? 'green' : undefined
}
export function groupTests(tests: readonly HomeTest[], summaries: SummaryResponse, search = '') {
  const groups = SURFACE_COPY.groups.map(label => ({ label, tests: [] as HomeTest[] }))
  const query = search.trim().toLocaleLowerCase('en-US')
  for (const test of tests) {
    if (!test.name.toLocaleLowerCase('en-US').includes(query)) continue
    const summary = summaries[test.id]
    const health = healthDot(test, summary)
    const index = test.status === 'running' ? health === 'red' || health === 'amber' ? 0 : 1
      : test.status === 'decided' ? 4 : test.status === 'archived' ? 5 : summary?.ready === true ? 2 : 3
    groups[index]!.tests.push(test)
  }
  return groups
}
const number = (value: number | null | undefined) => value != null && Number.isFinite(value)
  ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value) : '—'
export function homeCard(test: HomeTest, summary: Summary, adminRoute: string, flagPoints?: ReadinessContext['flagPoints']) {
  const results = ['running', 'stopped', 'decided', 'archived'].includes(test.status)
  const href = formatAdminURL({ adminRoute, path: `/experiments/${encodeURIComponent(test.id)}${results ? '/results' : ''}` })
  let line: string = summary?.ready === true ? SURFACE_COPY.ready : nextCopy(SURFACE_COPY.next)
  const next = summary?.next
  if ((test.status === 'draft' || test.status === 'stopped') && summary?.ready !== true && next && Object.hasOwn(READINESS, next.code)) {
    // Keep unexpected text out of authored copy, including responses from older servers.
    const sentence = READINESS[next.code].next(sanitizeReadinessDetail(next.code, next.detail), { ...test, arms: test.arms ?? [], flagPoints })
    if (sentence) line = nextCopy(sentence)
  }
  if (test.status === 'running') line = runningLine(number(summary?.days), number(test.analysis?.plannedDurationDays), number(summary?.exposures))
  if (test.status === 'decided') {
    const date = test.decidedAt ? new Date(test.decidedAt) : undefined
    const winner = test.decision?.winnerArm
    const winnerLabel = test.arms?.find(arm => arm.key === winner)?.label?.trim()
    line = decidedLine(date && Number.isFinite(date.valueOf()) ? date.toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
    }) : '—',
      winner ? winnerLabel || armLabel(winner) : '—')
  }
  if (test.status === 'archived') line = statusPill(test).label
  return {
    kind: SURFACE_COPY.kinds[test.kind], pill: statusPill(test), line,
    health: healthDot(test, summary), href,
    action: results ? SURFACE_COPY.results : test.status === 'draft' || test.status === 'stopped' ? SURFACE_COPY.continue : SURFACE_COPY.open,
  }
}
