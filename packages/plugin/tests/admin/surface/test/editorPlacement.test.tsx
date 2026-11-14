// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { pageBlockParts } from '../../../../src/testSurface/surface/pageBlock/parts.js'
import { editorPlacementMessage, SAVE_PAGE, PUBLISH_PAGE } from '../../../../src/testSurface/surface/editorPlacement.js'
import { props } from '../readiness/fixtures.js'
afterEach(cleanup)
test('admin binding keeps its original instructions; editor context names saving and publishing only for this page', () => {
  const p = props()
  render(<pageBlockParts.Binding {...p} />)
  expect(screen.getByText('Not on a page yet. Open a page, add an Experiment block and choose this test.')).toBeTruthy()
  const page = { collection: 'pages', id: '7' }
  expect(editorPlacementMessage([], undefined)).toBeUndefined()
  expect(editorPlacementMessage(undefined, page)).toBeUndefined()
  expect(editorPlacementMessage([], page)).toBe(SAVE_PAGE)
  expect(editorPlacementMessage([{ ...page, title: 'Page', ok: true, detail: 'Draft' }], page)).toBe(PUBLISH_PAGE)
  expect(editorPlacementMessage([{ ...page, title: 'Page', ok: true, detail: 'Published' }], page)).toBeUndefined()
  expect(editorPlacementMessage([{ ...page, id: '8', title: 'Other', ok: true, detail: 'Published' }], page)).toBe(SAVE_PAGE)
})
