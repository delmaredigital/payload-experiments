import { expect, test } from 'vitest'
import type { ExperimentKind, Status } from '../../../src/types/contracts.js'
import { availableActions } from '../../../src/admin/actions/actions.model.js'
import { ACTIONS_COPY as C, decideCopy, makeContentCopy, releaseCopy } from '../../../src/admin/copy/actions.js'

const statuses: Status[] = ['draft', 'running', 'stopped', 'decided', 'archived']
const kinds: ExperimentKind[] = ['block', 'page', 'flag', 'code']
test('status × kind × holdout × winner × release × report × permission action table', () => {
  for (const status of statuses) for (const kind of kinds) for (const holdout of [false, true])
    for (const winnerArm of [null, 'control', 'variantA']) for (const released of [false, true])
      for (const report of [undefined, [{ collection: 'pages', id: 1, ok: false }], [{ collection: 'pages', id: 1, ok: true }]])
        for (const canManage of [false, true]) {
          const arms = [{ key: 'control' }, { key: 'variantA' }, ...(holdout ? [{ key: 'holdout' }] : [])]
          const actions = availableActions({ status, kind, arms, canManage, decision: {
            winnerArm, holdoutReleasedAt: released ? '2026-10-30' : null, contentReport: report ? { docs: report } : null,
          } })
          const expected = !canManage || status === 'archived' ? [] : status === 'draft' ? ['start']
            : status === 'running' ? ['stop', 'decide'] : status === 'stopped' ? ['start', 'decide', 'archive']
              : [...(holdout && winnerArm === 'variantA' && !released ? ['release-holdout'] : []),
                ...(kind !== 'code' ? ['make-content'] : []), ...(report?.every(doc => doc.ok) ? ['after-content'] : []),
                'discard', ...(kind === 'code' ? ['hard-coded'] : [])]
          expect(actions.map(action => action.id), JSON.stringify({ status, kind, holdout, winnerArm, released, report, canManage })).toEqual(expected)
          for (const action of actions) {
            expect(action.confirm.title).toBe(action.label)
            if (action.id === 'stop') expect(action.confirm.body).toBe('Everyone will see the Original. Starting again begins a new round; results restart.')
            if (action.id === 'start' && status === 'stopped') {
              expect(action.label).toBe('Start a new round')
              expect(action.confirm.body).toBe('Starting again begins a new round; results restart.')
            }
            if (action.id === 'after-content') { expect(action.label).toBe('Finish archiving'); expect(action.archive).toEqual({ mode: 'after-content' }) }
            if (action.id === 'archive') expect(action.archive).toEqual({ mode: 'stopped' })
            if (action.id === 'discard') { expect(action.archive).toEqual({ mode: 'discard' }); expect(action.confirm.body).toBe(C.discardBody) }
            const label = winnerArm === 'variantA' ? 'Variant A' : 'Original'
            if (action.id === 'release-holdout') expect(action.confirm.body).toBe(releaseCopy(label))
            if (action.id === 'make-content') expect(action.confirm.body).toBe(makeContentCopy(label))
          }
        }
})
test('decide copy covers Original and variants with and without a holdout', () => {
  expect(decideCopy('Original', true, true)).toBe('Everyone will see the Original.')
  expect(decideCopy('Variant A', true, false)).toBe('Everyone except the holdout will see Variant A. The holdout keeps seeing the Original so we can measure the shipped change.')
  expect(decideCopy('Variant A', false, false)).toBe('Everyone will see Variant A.')
  expect(releaseCopy('Variant A')).toBe('The holdout will see Variant A too. Measuring since shipping ends.')
  expect(makeContentCopy('Variant A')).toBe('Copies Variant A into the page content so the experiment can be archived.')
})
