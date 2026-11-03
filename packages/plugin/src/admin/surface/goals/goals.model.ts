import type { DocId } from '../../../types/contracts.js'

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

export function goalSlug(name: string): string {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
