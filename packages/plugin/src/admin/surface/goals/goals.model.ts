import { TEST_PAGE } from '../../copy/testPage.js'
import { GOALS_COPY } from '../../copy/goals.js'
import { statusLabel } from '../../labels.js'
import type { DocId, Status } from '../../../types/contracts.js'

export interface Goal {
  id: DocId
  name: string
  slug: string
  source: string
  direction: 'increase' | 'decrease'
  attributionWindowHours?: number | null
  minSampleSize?: number | null
  guardrailThreshold?: number | null
  capping?: { type?: 'percentile' | 'absolute' | null; value?: number | null } | null
}
type Reference = DocId | { id: DocId } | null
export interface GoalUsageTest {
  id: DocId
  name?: string | null
  status?: Status | null
  metrics?: { primary?: Reference; secondary?: Reference[] | null; guardrails?: Reference[] | null } | null
}

/** Count each experiment once per goal, retaining the API's id types. */
export function goalUsage(tests: readonly GoalUsageTest[]): Map<DocId, number> {
  const byGoal = new Map<DocId, Set<DocId>>()
  for (const test of tests) {
    const references = [test.metrics?.primary, ...(test.metrics?.secondary ?? []), ...(test.metrics?.guardrails ?? [])]
    for (const reference of references) {
      const id = reference && typeof reference === 'object' ? reference.id : reference
      if (id == null) continue
      const used = byGoal.get(id) ?? new Set<DocId>()
      used.add(test.id)
      byGoal.set(id, used)
    }
  }
  return new Map([...byGoal].map(([id, tests]) => [id, tests.size]))
}

export { goalSlug } from '../../../goals/picker/clickGoalPicker.model.js'

const referenceId = (reference: Reference | undefined) => reference && typeof reference === 'object' ? reference.id : reference
const usageLabels = {
  primary: TEST_PAGE.goal,
  guardrails: TEST_PAGE.guardrails.replace(' (optional)', ''),
  secondary: TEST_PAGE.secondary.replace(' (optional)', ''),
}

/** One row per test, retaining every role without exposing unreadable names or links. */
export function goalUsageRows(tests: readonly GoalUsageTest[], goalId: DocId) {
  const rows = new Map<DocId, { id: DocId; name: string; canOpen: boolean; roles: string[]; status?: string }>()
  for (const test of tests) {
    const roles = [
      ...(referenceId(test.metrics?.primary) === goalId ? [usageLabels.primary] : []),
      ...(test.metrics?.guardrails?.some(reference => referenceId(reference) === goalId) ? [usageLabels.guardrails] : []),
      ...(test.metrics?.secondary?.some(reference => referenceId(reference) === goalId) ? [usageLabels.secondary] : []),
    ]
    if (!roles.length) continue
    const previous = rows.get(test.id)
    const canOpen = Boolean(test.name?.trim())
    rows.set(test.id, { id: test.id, name: canOpen ? test.name! : GOALS_COPY.unreadableTest, canOpen,
      roles: [...new Set([...(previous?.roles ?? []), ...roles])], status: test.status ? statusLabel(test.status) : undefined })
  }
  return [...rows.values()]
}

export function visibleGoalUsage<T>(rows: readonly T[], expanded: boolean): readonly T[] {
  return expanded ? rows : rows.slice(0, 5)
}
