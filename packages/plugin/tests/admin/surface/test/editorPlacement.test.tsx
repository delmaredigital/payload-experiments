// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { pageBlockParts } from '../../../../src/testSurface/surface/pageBlock/parts.js'
import { editorPlacementChecks, editorPlacementMessage, editorNestedChecks, SAVE_PAGE, PUBLISH_PAGE } from '../../../../src/testSurface/surface/editorPlacement.js'
import { props } from '../readiness/fixtures.js'
afterEach(cleanup)
test('admin binding keeps its original instructions; editor context names saving and publishing only for this page', () => {
  const p = props()
  render(<pageBlockParts.Binding {...p} />)
  expect(screen.getByText('Not on a page yet. Open a page, add an Experiment block and choose this test.')).toBeTruthy()
  const page = { collection: 'pages', id: '7' }
  expect(editorPlacementMessage([], undefined, 'draft')).toBeUndefined()
  expect(editorPlacementMessage(undefined, page, 'draft')).toBeUndefined()
  expect(editorPlacementMessage([], page, 'draft')).toBe(SAVE_PAGE)
  expect(editorPlacementMessage([{ ...page, title: 'Page', ok: true, detail: 'Draft' }], page, 'draft')).toBe(PUBLISH_PAGE)
  expect(editorPlacementMessage([{ ...page, title: 'Page', ok: true, detail: 'Published' }], page, 'draft')).toBeUndefined()
  expect(editorPlacementMessage([{ ...page, id: '8', title: 'Other', ok: true, detail: 'Published' }], page, 'draft')).toBe(SAVE_PAGE)
})

test.each(['draft', 'stopped', 'running', 'decided', 'archived'] as const)('placement guidance tells the truth for %s', status => {
  const page = { collection: 'pages', id: '7' }
  const draft = [{ ...page, title: 'Page', ok: true, detail: 'Draft' }]
  const setup = status === 'draft' || status === 'stopped'
  expect(editorPlacementMessage([], page, status)).toBe(setup ? SAVE_PAGE : status === 'running' ? "This test is running, but visitors won't see it here until this page is saved and published." : undefined)
  expect(editorPlacementMessage(draft, page, status)).toBe(setup ? PUBLISH_PAGE : status === 'running' ? "This test is running, but visitors won't see it here until this page is published." : undefined)
})

test('local placement guidance preserves other pages and the removed-block check', () => {
  const here = { collection: 'pages', id: '7', title: 'Here' }
  const other = { collection: 'pages', id: '8', title: 'Other' }
  expect(editorPlacementChecks([
    { code: 'no-placements', ok: false }, { code: 'placement-removed', ok: false },
    { code: 'placement-unpublished', ok: false, detail: [here, other] },
  ], here)).toEqual([
    { code: 'placement-removed', ok: false },
    { code: 'placement-unpublished', ok: false, detail: [other] },
  ])
})


test('the local nested notice collapses only its own pair and page, preserving other pages and pairs', () => {
  const page = { collection: 'pages', id: '7' }
  const here = { ...page, outer: 'Outer', inner: 'Inner', outerSlug: 'outer', innerSlug: 'inner', title: 'Home · All languages', allLocales: true }
  const otherPage = { ...here, id: 8, title: 'About · Languages: French', allLocales: undefined, locales: ['French'] }
  const otherPair = { ...here, inner: 'Another inner', innerSlug: 'another-inner' }
  expect(editorNestedChecks([{ code: 'nested-tests', ok: false, detail: [here, otherPage, otherPair] }], page, { outerSlug: 'outer', innerSlug: 'inner' }))
    .toEqual([{ code: 'nested-tests', ok: false, detail: [otherPage, otherPair] }])
})
