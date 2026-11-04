import { expect, test } from 'vitest'
import { previewPages } from '../../../src/admin/previewLinks.model.js'
import type { PreflightResult } from '../../../src/types/endpoints.js'

test.each([
  { name: 'one Published and one Draft placement', details: ['Published', 'Draft'], slotCount: 1 },
  { name: 'two Published and one Draft placement', details: ['Published', 'Draft', 'Published'], slotCount: 2 },
  { name: 'two placements without detail', details: [undefined, undefined], slotCount: 2 },
])('counts the largest version for $name', ({ details, slotCount }) => {
  const placements: PreflightResult['placements'] = details.map(detail => ({
    collection: 'pages', id: 1, title: 'Home', ok: true, detail,
  }))
  const pages = previewPages(placements)
  expect(pages).toHaveLength(1)
  expect(pages[0]?.slotCount).toBe(slotCount)
})

test('keeps first-seen order and titles, merges numeric/string ids, and separates collections', () => {
  const placements: PreflightResult['placements'] = [
    { collection: 'pages', id: 2, title: 'About', ok: true },
    { collection: 'pages', id: 1, title: 'Published home', ok: true },
    { collection: 'articles', id: 1, title: 'Article', ok: true },
    { collection: 'pages', id: '1', title: 'Draft home', ok: false },
  ]
  expect(previewPages(placements)).toMatchObject([
    { key: 'pages\u00002', collection: 'pages', id: 2, title: 'About', slotCount: 1 },
    { key: 'pages\u00001', collection: 'pages', id: 1, title: 'Published home', slotCount: 2 },
    { key: 'articles\u00001', collection: 'articles', id: 1, title: 'Article', slotCount: 1 },
  ])
  expect(placements).toHaveLength(4)
  expect(placements[1]).not.toHaveProperty('slotCount')
  expect(placements[1]?.title).toBe('Published home')
})

test('uses the first available URL without replacing the first title or mutating placements', () => {
  const placements = [
    { collection: 'pages', id: 1, title: 'Home', ok: true },
    { collection: 'pages', id: 1, title: 'New home', url: '/home', ok: true },
    { collection: 'pages', id: 1, title: 'Later home', url: '/later', ok: true },
  ]
  expect(previewPages(placements)[0]).toMatchObject({ title: 'Home', url: '/home', slotCount: 3 })
  expect(placements[0]).not.toHaveProperty('url')
})

test('page keys cannot collide across collection/id boundaries', () => {
  const pages = previewPages([
    { collection: 'pages', id: '1', title: 'Home', ok: true },
    { collection: 'pages/1', id: '', title: 'Other', ok: true },
  ])
  expect(pages).toHaveLength(2)
  expect(new Set(pages.map(page => page.key)).size).toBe(2)
})

test('no placements means no preview pages', () => {
  expect(previewPages([])).toEqual([])
})

test('flag-point placement rows are never grouped or counted as page slots', () => {
  const placements = [
    { collection: 'signup-choice', id: 'variantA', title: 'Signup page', ok: true },
    { collection: 'signup-choice', id: 'variantA', title: 'Another signup page', ok: true },
  ]
  const rows = previewPages(placements, 'signup-choice')
  expect(rows).toHaveLength(2)
  expect(rows.map(row => row.title)).toEqual(['Signup page', 'Another signup page'])
  expect(rows.every(row => row.slotCount === 1)).toBe(true)
  expect(new Set(rows.map(row => row.key)).size).toBe(2)
})
