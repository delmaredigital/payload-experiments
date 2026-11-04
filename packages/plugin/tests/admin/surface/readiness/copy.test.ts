import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { availableActions } from '../../../../src/admin/actions/actions.model.js'
import * as copy from '../../../../src/admin/copy/readiness.js'

test('block path readiness uses the coordinator removal copy', () => {
  expect(copy.READINESS_COPY.blockPathRule).toBe('Remove the page-path rule in Who takes part; page block tests run on their page.')
  expect(copy.READINESS_COPY.removeRule).toBe('Remove rule')
})

test('readiness copy uses editor language, including generated sentences', () => {
  const forbidden = /\b(arms?|phases?|flag point|unit type|CUPED|exposure policy)\b/i
  const source = readFileSync(new URL('../../../../src/admin/copy/readiness.ts', import.meta.url), 'utf8')
  expect(source).not.toMatch(forbidden)
  for (const value of Object.values(copy)) {
    if (typeof value === 'object') for (const sentence of Object.values(value)) expect(sentence).not.toMatch(forbidden)
  }
  for (const sentence of [copy.contentNext('Original'), copy.parameterNext('Headline', 'Variant A'), copy.stoppedCopy(null),
    ...(['running', 'decided', 'archived'] as const).map(status => copy.pageGuardCopy('Example', status)),
    ...['running', 'decided'].flatMap(status => [copy.versionPageUnavailableCopy('/example', status), copy.versionPageUncheckedCopy('/example', status)]), copy.decidedCopy(null, 'Variant A'), copy.runningCopy(null, 100, 2)]) expect(sentence).not.toMatch(forbidden)
})

test('page refusals and health instructions match the test status', () => {
  expect(copy.pageGuardCopy('Example', 'running')).toBe('This page is part of the running test "Example". Stop the test before you delete, rename or unpublish it.')
  expect(copy.pageGuardCopy('Example', 'decided')).toBe('This page is part of the decided test "Example". Choose "Make it the content" or "Discard winner" on the test before you delete, rename or unpublish it.')
  expect(copy.pageGuardCopy('Example', 'archived')).toBe('This page is shown at other addresses because the finished test "Example" made it the winner. To free it, open the test and choose "Release pages".')
  expect(copy.versionPageUnavailableCopy('/page', 'decided')).toBe("/page isn't published, so visitors assigned to it see an error. Republish it, or discard the winner.")
  expect(copy.versionPageUnavailableCopy('/page', 'running')).toBe("/page isn't published, so visitors assigned to it see an error. Republish it, or stop the test.")
  expect(copy.versionPageUncheckedCopy('/page', 'decided')).toBe("Couldn't check whether /page is published. Check that it is still published, or discard the winner.")
  expect(copy.versionPageUncheckedCopy('/page', 'running')).toBe("Couldn't check whether /page is published. Check that it is still published, or stop the test.")
})

test.each(['running', 'decided'] as const)('page refusal actions exist for %s tests', status => {
  const actions = availableActions({ status, kind: 'page', arms: [], canManage: true })
  for (const id of status === 'running' ? ['stop'] : ['make-content', 'discard']) {
    expect(copy.pageGuardCopy('Example', status)).toContain(actions.find(action => action.id === id)!.label)
  }
})
