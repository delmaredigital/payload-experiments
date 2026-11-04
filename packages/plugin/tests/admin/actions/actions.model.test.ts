import { expect, test } from 'vitest'
import { availableActions, contentDone, type ContentReport } from '../../../src/admin/actions/actions.model.js'
import { decideCopy, makeContentCopy, releaseCopy } from '../../../src/admin/copy/actions.js'

type Input = Parameters<typeof availableActions>[0]
type Case = { name: string; input: Partial<Input>; expected: Array<[string, string, string]> }
const arms = [{ key: 'control' }, { key: 'variantA', label: ' Short headline ' }, { key: 'holdout' }]
const ok = { collection: 'pages', id: 1, ok: true }
const failed = { collection: 'pages', id: 2, ok: false }
const cases: Case[] = [
  { name: 'draft', input: { status: 'draft' }, expected: [['start', 'Start', 'primary']] },
  { name: 'running', input: { status: 'running' }, expected: [['stop', 'Stop', 'danger'], ['decide', 'Decide', 'primary'], ['allocate', 'Raise allocation', 'secondary'], ['add-metric', 'Add a metric', 'secondary']] },
  { name: 'stopped', input: { status: 'stopped' }, expected: [['start', 'Start a new round', 'primary'], ['decide', 'Decide', 'primary'], ['archive', 'Archive', 'secondary']] },
  { name: 'archived', input: { status: 'archived' }, expected: [] },
  { name: 'draft without permission', input: { status: 'draft', canManage: false }, expected: [] },
  { name: 'running without permission', input: { status: 'running', canManage: false }, expected: [] },
  { name: 'stopped without permission', input: { status: 'stopped', canManage: false }, expected: [] },
  { name: 'decided without permission', input: { canManage: false }, expected: [] },
  { name: 'block, variant, open holdout, absent report', input: { kind: 'block' }, expected: [['release-holdout', 'Release holdout', 'secondary'], ['make-content', 'Make it the content', 'primary'], ['discard', 'Discard winner', 'danger']] },
  { name: 'page, variant, open holdout', input: { kind: 'page' }, expected: [['release-holdout', 'Release holdout', 'secondary'], ['make-content', 'Make it the content', 'primary'], ['discard', 'Discard winner', 'danger']] },
  { name: 'flag, variant, open holdout', input: { kind: 'flag' }, expected: [['release-holdout', 'Release holdout', 'secondary'], ['make-content', 'Make it the content', 'primary'], ['discard', 'Discard winner', 'danger']] },
  { name: 'code, variant, open holdout', input: { kind: 'code' }, expected: [['release-holdout', 'Release holdout', 'secondary'], ['discard', 'Discard winner', 'danger'], ['hard-coded', 'The developer has hard-coded Short headline', 'primary']] },
  { name: 'no holdout', input: { arms: arms.slice(0, 2) }, expected: [['make-content', 'Make it the content', 'primary'], ['discard', 'Discard winner', 'danger']] },
  { name: 'Original wins', input: { decision: { winnerArm: 'control' } }, expected: [['make-content', 'Make it the content', 'primary'], ['discard', 'Discard winner', 'danger']] },
  { name: 'no winner', input: { decision: { winnerArm: null } }, expected: [['make-content', 'Make it the content', 'primary'], ['discard', 'Discard winner', 'danger']] },
  { name: 'released holdout', input: { decision: { winnerArm: 'variantA', holdoutReleasedAt: '2026-10-30' } }, expected: [['make-content', 'Make it the content', 'primary'], ['discard', 'Discard winner', 'danger']] },
  { name: 'empty array report', input: { decision: { winnerArm: 'variantA', contentReport: [] } }, expected: [['release-holdout', 'Release holdout', 'secondary'], ['make-content', 'Make it the content', 'primary'], ['discard', 'Discard winner', 'danger']] },
  { name: 'empty docs report', input: { decision: { winnerArm: 'variantA', contentReport: { docs: [] } } }, expected: [['release-holdout', 'Release holdout', 'secondary'], ['make-content', 'Make it the content', 'primary'], ['discard', 'Discard winner', 'danger']] },
  { name: 'all-ok array report', input: { decision: { winnerArm: 'variantA', contentReport: [ok] } }, expected: [['release-holdout', 'Release holdout', 'secondary'], ['make-content', 'Make it the content', 'primary'], ['after-content', 'Finish archiving', 'secondary'], ['discard', 'Discard winner', 'danger']] },
  { name: 'all-ok docs report', input: { decision: { winnerArm: 'variantA', contentReport: { docs: [ok] } } }, expected: [['release-holdout', 'Release holdout', 'secondary'], ['make-content', 'Make it the content', 'primary'], ['after-content', 'Finish archiving', 'secondary'], ['discard', 'Discard winner', 'danger']] },
  { name: 'some-failed array report', input: { decision: { winnerArm: 'variantA', contentReport: [ok, failed] } }, expected: [['release-holdout', 'Release holdout', 'secondary'], ['make-content', 'Make it the content', 'primary'], ['discard', 'Discard winner', 'danger']] },
  { name: 'some-failed docs report', input: { decision: { winnerArm: 'variantA', contentReport: { docs: [ok, failed] } } }, expected: [['release-holdout', 'Release holdout', 'secondary'], ['make-content', 'Make it the content', 'primary'], ['discard', 'Discard winner', 'danger']] },
  { name: 'code after content', input: { kind: 'code', decision: { winnerArm: 'variantA', contentReport: [ok] } }, expected: [['release-holdout', 'Release holdout', 'secondary'], ['after-content', 'Finish archiving', 'secondary'], ['discard', 'Discard winner', 'danger'], ['hard-coded', 'The developer has hard-coded Short headline', 'primary']] },
  { name: 'code Original without holdout', input: { kind: 'code', arms: arms.slice(0, 2), decision: { winnerArm: 'control' } }, expected: [['discard', 'Discard winner', 'danger'], ['hard-coded', 'The developer has hard-coded Original', 'primary']] },
]

test.each(cases)('$name: literal ordered ids, labels and tones', ({ input, expected }) => {
  const actions = availableActions({ status: 'decided', kind: 'block', arms, decision: { winnerArm: 'variantA' }, canManage: true, ...input })
  expect(actions.map(({ id, label, tone }) => [id, label, tone])).toEqual(expected)
  for (const action of actions) expect(action.confirm.title).toBe(action.label)
})

test('transition copy and archive modes', () => {
  const actions = availableActions({ status: 'stopped', kind: 'block', arms, canManage: true })
  expect(actions[0]?.confirm.body).toBe('Starting again begins a new round; results restart.')
  expect(actions[2]?.archive).toEqual({ mode: 'stopped' })
  expect(availableActions({ status: 'running', kind: 'block', arms, canManage: true })[0]?.confirm.body)
    .toBe('Everyone will see the Original. Starting again begins a new round; results restart.')
  const decided = availableActions({ status: 'decided', kind: 'code', arms, canManage: true,
    decision: { winnerArm: 'variantA', contentReport: [ok] } })
  expect(decided.map(action => action.archive)).toEqual([undefined, { mode: 'after-content' }, { mode: 'discard' }, { mode: 'hard-coded' }])
  expect(decided[0]?.confirm.body).toBe('The holdout will see Short headline too. Measuring since shipping ends.')
  expect(decided[2]?.confirm.body).toBe('Everyone goes back to the Original. The decision note is kept.')
  expect(decided[3]?.confirm.phrase).toEqual({ action: 'hard-coded' })
})
test.each(['block', 'page', 'flag'] as const)('make-content copy for %s', kind => {
  const expected = kind === 'flag'
    ? "Saves Short headline's settings as the new defaults so the test can be archived."
    : 'Copies Short headline into the page content so the test can be archived.'
  expect(makeContentCopy('Short headline', kind)).toBe(expected)
  expect(availableActions({ status: 'decided', kind, arms, canManage: true, decision: { winnerArm: 'variantA' } })
    .find(action => action.id === 'make-content')?.confirm.body).toBe(expected)
})
test('decide copy covers Original and variants with and without a holdout', () => {
  expect(decideCopy('Original', true, true)).toBe('Everyone will see the Original.')
  expect(decideCopy('Short headline', true, false)).toBe('Everyone except the holdout will see Short headline. The holdout keeps seeing the Original so we can measure the shipped change.')
  expect(decideCopy('Short headline', false, false)).toBe('Everyone will see Short headline.')
  expect(releaseCopy('Short headline')).toBe('The holdout will see Short headline too. Measuring since shipping ends.')
})

test.each([
  ['all updated', { docs: [ok] }, true],
  ['updated and dismissed', { docs: [ok, { ...failed, dismissedAt: '2026-11-03T12:00:00Z' }] }, true],
  ['dismissed array report', [{ ...failed, dismissedAt: '2026-11-03T12:00:00Z' }], true],
  ['one outstanding failure', { docs: [ok, failed] }, false],
  ['empty', { docs: [] }, false],
  ['empty array', [], false],
  ['absent', undefined, false],
  ['null', null, false],
] as const)('contentDone: %s', (_name, report, done) => {
  expect(contentDone(report as ContentReport | null | undefined)).toBe(done)
})

test('a dismissed failure permits the existing after-content archive action', () => {
  const action = availableActions({ status: 'decided', kind: 'block', arms, canManage: true,
    decision: { winnerArm: 'variantA', contentReport: { docs: [ok, { ...failed, dismissedAt: '2026-11-03T12:00:00Z' }] } } })
    .find(action => action.id === 'after-content')
  expect(action?.archive).toEqual({ mode: 'after-content' })
})
