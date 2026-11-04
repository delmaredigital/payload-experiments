import { expect, test } from 'vitest'
import { lockedReason } from '../../src/admin/lockedNotice.model.js'
import type { Status } from '../../src/types/contracts.js'
import type { EditableField } from '../../src/types/admin.js'

// Spec §5.1: weights are contained in arms; running metric additions use a transition.
const table = {
  draft: ['name', 'hypothesis', 'arms', 'targeting', 'allocation', 'flagPoint', 'metrics', 'analysis', 'exposurePolicy'],
  stopped: ['name', 'hypothesis', 'arms', 'targeting', 'allocation', 'metrics', 'analysis', 'exposurePolicy'],
  running: ['name', 'hypothesis'], decided: ['name', 'hypothesis'], archived: [],
} satisfies Record<Status, readonly EditableField[]>
const fields = ['name', 'hypothesis', 'arms', 'targeting', 'allocation', 'flagPoint', 'metrics', 'analysis', 'exposurePolicy',
  'slug', 'kind', 'unitType', 'layer', 'status', 'seed', 'phase', 'layerSlices', 'decision', 'startedAt', 'endedAt', 'decidedAt', 'createdAt', 'updatedAt']
const reasons = {
  draft: "Can't be changed in this state.", stopped: "Can't be changed in this state.",
  running: 'Locked while the test is running so everyone in this round sees the same thing. Stop the test to change it.',
  decided: 'Locked after the decision.', archived: "Archived tests can't be changed.",
}
for (const status of Object.keys(table) as Status[]) for (const field of fields) test(`${status}: ${field}`, () => {
  const expected = ['slug', 'kind', 'unitType', 'layer'].includes(field) ? 'Set when the test was created.'
    : (table[status] as readonly string[]).includes(field) ? null : reasons[status]
  const runningReason = field === 'allocation' ? 'To include more people, use "Let more people in" at the bottom of the page. To include fewer, stop the test; the change applies when you start it again.'
    : field === 'metrics' ? 'Add a guardrail or something to watch with "Add a goal" at the bottom of the page; the main goal is fixed for this round.' : expected
  expect(lockedReason(status, field, table)).toBe(status === 'running' ? runningReason : expected)
})
