import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { availableActions } from '../../../../src/admin/actions/actions.model.js'
import * as copy from '../../../../src/admin/copy/readiness.js'
import { PAGE_COPY } from '../../../../src/admin/copy/pages.js'

test('unchosen page copy stays aligned with the page-row empty state', () => {
  expect(PAGE_COPY.noPage).toBe('No page chosen yet.')
})

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
    copy.pageInUseCopy('/example'), ...(['running', 'decided', 'archived'] as const).map(status => copy.pageGuardCopy('Example', status)),
    ...['running', 'decided'].flatMap(status => [copy.versionPageUnavailableCopy('/example', status), copy.versionPageUncheckedCopy('/example', status)]), copy.decidedCopy(null, 'Variant A'), copy.runningCopy(null, 100, 2)]) expect(sentence).not.toMatch(forbidden)
})

test('page refusals and health instructions match the test status', () => {
  expect(copy.pageGuardCopy('Example', 'running')).toBe('This page is part of the running test "Example". Stop the test before you delete, rename or unpublish it.')
  expect(copy.pageGuardCopy('Example', 'decided')).toBe('This page is part of the decided test "Example". Choose "Make it the content" or "Discard winner" on the test before you delete, rename or unpublish it.')
  expect(copy.pageGuardCopy('Example', 'archived')).toBe('This page is shown at other addresses because the finished test "Example" made it the winner. To free it, open the test and choose "Release pages".')
  expect(copy.pageGuardCopy('Example', 'archived', 'original')).toBe('This page\'s address now shows the winner of the finished test "Example". To free it, open the test and choose "Release pages".')
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


test('page conflict readiness uses the coordinator copy', () => {
  expect(copy.pageInUseCopy('/original')).toBe('Another running or decided test already uses /original. Choose a different page, or finish that test first.')
  expect(copy.READINESS_COPY.chooseDifferentPage).toBe('Choose a different page')
})

test('manual page setup copy shares its server form and every contextual sentence', () => {
  expect(copy.unpublishedPageCopy('/copy')).toBe("/copy isn't a published page yet. Publish it, or choose another page.")
  expect(copy.unpublishedPageCopy('/copy', { original: false, found: true, collection: 'Pages' })).toBe('/copy is still a draft. Publish it in Pages, then start the test.')
  expect(copy.unpublishedPageCopy('/copy', { original: false, found: false, collection: 'Pages' })).toBe("/copy isn't published yet, or no page has that address. Publish it in Pages, or choose another page.")
  expect(copy.unpublishedPageCopy('/copy', { original: true, found: false, collection: 'Pages' })).toBe("/copy isn't published, so it can't be the Original. Publish it, or choose another page.")
  expect(copy.pageInUseCopy('/copy', true)).toBe('/copy is already in another running or decided test. Make a new copy of the Original for this version, or finish that test first.')
  expect(copy.sameAddressCopy('Variant A', 'Original', '/copy')).toBe('Variant A has the same address (/copy) as Original. Choose a different page.')
  expect(copy.sameAddressCopy('Variant A', 'Original', '/copy', 'Pages')).toBe('Variant A has the same address (/copy) as Original. Choose a different page. Give the copy its own address in Pages, publish it, then choose it.')
})
