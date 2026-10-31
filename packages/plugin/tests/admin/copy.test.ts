import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import * as labels from '../../src/admin/labels.js'
import { STATUS_TOOLTIPS } from '../../src/admin/copy/status.js'
import { refusalMessage } from '../../src/admin/copy/common.js'
import type { ArmKey, ExperimentKind, Status } from '../../src/types/contracts.js'
import type { VerdictCode } from '../../src/types/snapshot.js'

function checkStrings(value: unknown) {
  if (typeof value === 'string') expect(value).not.toMatch(/\b(arms?|phases?)\b/i)
  else if (value && typeof value === 'object') for (const item of Object.values(value)) checkStrings(item)
}
function modules(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
    return entry.isDirectory() ? modules(url) : entry.name.endsWith('.ts') ? [url] : []
  })
}
test('all copy exports and label maps use user language', async () => {
  for (const url of modules(new URL('../../src/admin/copy/', import.meta.url))) {
    checkStrings(await import(/* @vite-ignore */ fileURLToPath(url)))
  }
  checkStrings(labels)
  for (const code of ['not-found', 'commit-unverified', 'not-implemented', 'forbidden', 'other']) checkStrings(refusalMessage(code, 422))
})
const armKeys = { control: 'Original', variantA: 'Variant A', variantB: 'Variant B', variantC: 'Variant C', holdout: 'Holdout' } satisfies Record<ArmKey, string>
const statuses = { draft: 'Draft', running: 'Running', stopped: 'Stopped', decided: 'Decided', archived: 'Archived' } satisfies Record<Status, string>
const verdicts = {
  unavailable: 'Results unavailable', 'data-problem': 'Check the data', 'guardrail-failing': 'An important outcome got worse',
  collecting: 'Collecting results', 'original-better': 'The Original is better', 'worse-none-better': 'No better option',
  winner: 'A winner', mixed: 'Mixed results', 'keep-running': 'Keep running', 'no-difference': 'No clear difference',
  'rollout-collecting': 'Collecting results after shipping', 'rollout-readout': 'Results after shipping',
} satisfies Record<VerdictCode, string>
const kinds = { block: 'Block on a page', page: 'Whole page', flag: 'Setting in code', code: 'Developer code' } satisfies Record<ExperimentKind, string>
test('labels cover the type vocabulary', () => {
  for (const key of Object.keys(armKeys) as ArmKey[]) { expect(labels.armLabel(key, 'Stored')).toBe(armKeys[key]); checkStrings(labels.armLabel(key)) }
  for (const status of Object.keys(statuses) as Status[]) expect(labels.statusLabel(status)).toBe(statuses[status])
  for (const code of Object.keys(verdicts) as VerdictCode[]) expect(labels.verdictCodeLabel(code)).toBe(verdicts[code])
  for (const kind of Object.keys(kinds) as ExperimentKind[]) expect(labels.kindLabel(kind)).toBe(kinds[kind])
  expect(labels.phaseKindLabel('test')).toBe('during the test')
  expect(labels.phaseKindLabel('rollout')).toBe('after shipping')
  expect(labels.armLabel('legacy', 'New design')).toBe('New design')
  expect(labels.armLabel('legacy')).toBe('legacy')
  expect(labels.armLabel('toString')).toBe('toString')
})
test('status tooltips are verbatim', () => {
  expect(STATUS_TOOLTIPS).toEqual({ draft: 'Draft', running: 'Running', stopped: 'Stopped — everyone sees the Original',
    decided: 'Decided — everyone sees the winner', decidedWithHoldout: 'Decided — everyone sees the winner, except the holdout', archived: 'Archived' })
})
