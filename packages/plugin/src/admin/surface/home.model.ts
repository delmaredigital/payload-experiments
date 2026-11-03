import type { DocId, ExperimentKind, Status } from '../../types/contracts.js'
import { formatAdminURL } from 'payload/shared'
import type { SummaryResponse } from '../../types/endpoints.js'
import { armLabel } from '../labels.js'
import { statusPill } from '../status.model.js'
import { decidedLine, runningLine, SURFACE_COPY } from '../copy/surface.js'

export interface HomeTest {
  id: DocId; name: string; kind: ExperimentKind; status: Status
  analysis?: { plannedDurationDays?: number | null } | null
  arms?: Array<{ key: string; label?: string }> | null
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
export function homeCard(test: HomeTest, summary: Summary, adminRoute: string) {
  const results = ['running', 'stopped', 'decided'].includes(test.status)
  const href = formatAdminURL({ adminRoute, path: `/experiments/${encodeURIComponent(test.id)}${results ? '/results' : ''}` })
  let line = summary?.ready ? SURFACE_COPY.ready : SURFACE_COPY.next as string
  if (test.status === 'running') line = runningLine(number(summary?.days), number(test.analysis?.plannedDurationDays), number(summary?.exposures))
  if (test.status === 'decided') {
    const date = test.decidedAt ? new Date(test.decidedAt) : undefined
    const winner = test.decision?.winnerArm
    line = decidedLine(date && Number.isFinite(date.valueOf()) ? date.toLocaleDateString('en-US', { timeZone: 'UTC' }) : '—',
      winner ? armLabel(winner, test.arms?.find(arm => arm.key === winner)?.label) : '—')
  }
  if (test.status === 'archived') line = statusPill(test).label
  return {
    kind: SURFACE_COPY.kinds[test.kind], pill: statusPill(test), line,
    headline: test.status === 'running' ? summary?.verdict?.headline : undefined,
    health: healthDot(test, summary), href,
    action: results ? SURFACE_COPY.results : test.status === 'draft' || test.status === 'stopped' ? SURFACE_COPY.continue : SURFACE_COPY.open,
  }
}
