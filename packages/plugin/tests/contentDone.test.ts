import { expect, test } from 'vitest'
import { contentDone } from '../src/contentDone.js'
import type { ContentReport, MakeContentResult } from '../src/types/endpoints.js'

const ok = { collection: 'pages', id: 1, ok: true }
const failed = { collection: 'pages', id: 2, ok: false, detail: 'forbidden' }
const dismissed = { ...failed, dismissedAt: '2026-11-03T10:00:00.000Z', dismissedBy: '42' }

test.each([undefined, null, {}])('an absent report is not done: %j', report => {
  expect(contentDone(report as ContentReport | null | undefined)).toBe(false)
})
test.each([[], { docs: [] }])('a present but empty report is done (page and callback-free flag tests): %j', report => {
  expect(contentDone(report)).toBe(true)
})
test.each([false, true])('completion handles current and legacy reports (array=%s)', legacy => {
  for (const [docs, expected] of [
    [[ok], true], [[dismissed], true], [[ok, dismissed], true],
    [[failed], false], [[ok, failed], false], [[dismissed, failed], false],
    [[{ ...failed, dismissedBy: '42' }], false],
    [[{ ...failed, dismissedAt: '' }], false],
  ] satisfies Array<[MakeContentResult['docs'], boolean]>) {
    const report: ContentReport = legacy ? docs : { docs }
    const before = structuredClone(report)
    expect(contentDone(report)).toBe(expected)
    expect(report).toEqual(before)
  }
})
