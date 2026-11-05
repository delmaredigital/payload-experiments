import { expect, test } from 'vitest'
import { disabledPageReason, isLatestPageRequest, testPageCollection } from '../../../../src/admin/surface/pagePicker/pagePicker.model.js'
import type { PageRow } from '../../../../src/admin/surface/pagePicker/pagePicker.model.js'
import { doc } from '../readiness/fixtures.js'

const arms = doc.arms.map(arm => ({ ...arm, pageTarget: arm.kind === 'control' ? '/about/' : '/copy' }))
const row: PageRow = { id: 10, title: 'About', path: '/about', pathKey: '/about', published: false }
const placements = [{ arm: 'control', id: 10, path: '/about/', published: true }]

test('disables missing addresses', () => {
  expect(disabledPageReason({ ...row, path: null, pathKey: null }, 'variantA', arms, [], {}, 'Pages')).toBe('This page has no address yet.')
})
test('matches a page remembered this session before its stale preflight id, including a draft', () => {
  expect(disabledPageReason(row, 'variantA', arms, [{ ...placements[0]!, id: 20 }], { control: { id: 10, path: '/about/' } }, 'Pages')).toBe('This is Original.')
})
test('matches preflight identity before the normalized address fallback', () => {
  expect(disabledPageReason({ ...row, path: '/renamed', pathKey: '/renamed' }, 'variantA', arms, placements, {}, 'Pages')).toBe('This is Original.')
  expect(disabledPageReason(row, 'variantA', arms, [{ ...placements[0]!, id: null }], {}, 'Pages')).toBe('This is Original.')
  expect(disabledPageReason(row, 'variantA', arms, [], {}, 'Pages')).toBe('This is Original.')
})
test('different documents with the same normalized address get address guidance', () => {
  expect(disabledPageReason({ ...row, id: 11 }, 'variantA', arms, placements, {}, 'Pages')).toBe("Same address as Original (/about). Change this page's address in Pages, publish it, then choose it.")
})
test('control first, then arm order, and never disable the arm being edited', () => {
  const both = [{ ...arms[1]!, pageTarget: '/about' }, arms[0]!]
  expect(disabledPageReason(row, 'variantB', both, [], {}, 'Pages')).toBe('This is Original.')
  expect(disabledPageReason(row, 'control', arms, placements, {}, 'Pages')).toBeNull()
})
test('uses pathKey, ignores stale remembered paths, and retains server ordering', () => {
  expect(disabledPageReason({ ...row, path: '/raw', pathKey: '/about' }, 'variantA', arms, [], {}, 'Pages')).toBe('This is Original.')
  expect(disabledPageReason({ ...row, id: 11 }, 'variantA', arms, placements, { control: { id: 11, path: '/old' } }, 'Pages')).toContain('Same address')
  expect(isLatestPageRequest(1, 2)).toBe(false)
  expect(isLatestPageRequest(2, 2)).toBe(true)
})
test('collection comes only from stored collection or server placements', () => {
  const collections = [{ slug: 'pages', label: 'Pages', contentChecks: false }, { slug: 'posts', label: 'Posts', contentChecks: true }]
  const found = [{ ...placements[0]!, collection: 'posts' }]
  expect(testPageCollection(collections, { pageCollection: 'pages' }, found)).toBe(collections[0])
  expect(testPageCollection(collections, {}, found)).toBe(collections[1])
  expect(testPageCollection(collections, {}, [])).toBeUndefined()
  expect(testPageCollection(undefined, {}, found)).toBeUndefined()
})

test('preflight identities from a previous collection cannot disable an unrelated page', () => {
  const old = [{ ...placements[0]!, collection: 'pages' }]
  expect(disabledPageReason({ ...row, path: '/article', pathKey: '/article' }, 'variantA', arms, old, {}, 'Articles', 'articles')).toBeNull()
})
