import { expect, test } from 'vitest'
import { canReleasePages, pagesReleasedBy } from '../../../src/testSurface/results/releasePages.model.js'

const eligible = { kind: 'page', status: 'archived', decision: { winnerArm: 'variantA' } }
test('an archived whole-page winner can release its pages', () => {
  expect(canReleasePages(eligible)).toBe(true)
  expect(canReleasePages({ ...eligible, decision: { winnerArm: 'control' } })).toBe(true)
})
test.each(['block', 'flag', 'code', undefined])('kind %s cannot release pages', kind => {
  expect(canReleasePages({ ...eligible, kind })).toBe(false)
})
test.each(['draft', 'running', 'stopped', 'decided'])('status %s cannot release pages', status => {
  expect(canReleasePages({ ...eligible, status })).toBe(false)
})
test.each([undefined, null, {}, { winnerArm: '' }, { winnerArm: null }])('no winner: %j cannot release pages', decision => {
  expect(canReleasePages({ ...eligible, decision })).toBe(false)
})
test.each(['discardedAt', 'pagesReleasedAt'] as const)('%s alone turns off the action', field => {
  expect(canReleasePages({ ...eligible, decision: { ...eligible.decision, [field]: '2026-11-03T12:00:00Z' } })).toBe(false)
})
test('null optional timestamps retain the server gate', () => {
  expect(canReleasePages({ ...eligible, decision: { ...eligible.decision, discardedAt: null, pagesReleasedAt: null } })).toBe(true)
})
test('the release author is you for numeric or string current-user ids', () => {
  expect(pagesReleasedBy('7', 7, { name: 'Editor' })).toBe('you')
  expect(pagesReleasedBy('editor-id', 'editor-id')).toBe('you')
})
test('another author uses name, then email, or stays unresolved', () => {
  expect(pagesReleasedBy('7', 8, { name: 'Editor', email: 'editor@example.test' })).toBe('Editor')
  expect(pagesReleasedBy('7', 8, { name: null, email: 'editor@example.test' })).toBe('editor@example.test')
  expect(pagesReleasedBy('7', 8)).toBeUndefined()
  expect(pagesReleasedBy('7', 8, {})).toBeUndefined()
  expect(pagesReleasedBy(null, 8, { name: 'Editor' })).toBeUndefined()
})
