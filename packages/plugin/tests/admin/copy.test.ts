import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { DEFAULT_SEQUENTIAL_TUNING_PARAMETER } from '../../src/constants.js'
import { ADVANCED_COPY } from '../../src/admin/copy/advanced.js'
import * as puckCopy from '../../src/puck/copy.js'
import * as puckEditorCopy from '../../src/puck/editor/copy.js'
import * as labels from '../../src/admin/labels.js'
import { STATUS_TOOLTIPS } from '../../src/admin/copy/status.js'
import { API_MESSAGES, refusalMessage } from '../../src/admin/copy/common.js'
import type { ArmKey, ExperimentKind, Status } from '../../src/types/contracts.js'
import type { VerdictCode } from '../../src/types/snapshot.js'

test.each([
  ['not-found', 422], [undefined, 404], ['not-found', 404],
] as const)('not-found copy ignores server text for code %s and status %s', (code, status) => {
  for (const message of ['Metric not found', 'The phase record was not found.', 'Round not found', 'Experiment not found']) {
    expect(refusalMessage(code, status, message, { notFound: 'Choose another goal.' })).toBe('Choose another goal.')
    expect(refusalMessage(code, status, message)).toBe(API_MESSAGES.notFound)
  }
})
test.each([
  ['unauthenticated', 422, API_MESSAGES.unauthenticated], [undefined, 401, API_MESSAGES.unauthenticated],
  ['commit-unverified', 500, API_MESSAGES.commitUnverified],
  ['not-implemented', 422, API_MESSAGES.notImplemented], [undefined, 501, API_MESSAGES.notImplemented],
  ['forbidden', 422, API_MESSAGES.forbidden], [undefined, 403, API_MESSAGES.forbidden],
  ['invalid-status', 409, 'Server explanation'], ['future-code', 422, 'Server explanation'],
] as const)('not-found overrides leave code %s and status %s unchanged', (code, status, expected) => {
  expect(refusalMessage(code, status, 'Server explanation', { notFound: 'Choose another goal.' })).toBe(expected)
})
test('other uncoded refusals retain the generic fallback', () => {
  expect(refusalMessage(undefined, 400, undefined, { notFound: 'Choose another goal.' })).toBe(API_MESSAGES.failed)
})

function checkStrings(value: unknown) {
  // "Experiment block" is the Puck block's own name; every other user-facing string says "test".
  if (typeof value === 'string') expect(value.replace(/Experiment block/g, ''), value).not.toMatch(/\b(arms?|phases?|experiments?)\b/i)
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
  checkStrings(puckCopy)
  checkStrings(puckEditorCopy)
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

test('automatic sequential tuning copy matches the analysis default', () => {
  expect(ADVANCED_COPY.automaticTuning).toBe(`Automatic (${DEFAULT_SEQUENTIAL_TUNING_PARAMETER.toLocaleString('en-US')})`)
})
