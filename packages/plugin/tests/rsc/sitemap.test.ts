import { expect, test } from 'vitest'
import { experiment, manifest, page } from './helpers.js'
import { experimentSitemapFilter } from '../../src/server/sitemap.js'

test('build-time filter hides live variants, archived losers, keeps control and winner', () => {
  const m = manifest([page(), experiment({ slug: 'block' })]); m.archivedPages = { '/loser': { slug: 'old', winnerPath: '/winner' } }
  expect(experimentSitemapFilter('/variant', m)).toBe(false)
  expect(experimentSitemapFilter('/loser', m)).toBe(false)
  for (const path of ['/original', '/winner', '/other', '/constructor']) expect(experimentSitemapFilter(path, m)).toBe(true)
})
test('live control overrides archived losing-path mapping', () => {
  const m = manifest([page()]); m.archivedPages['/original'] = { slug: 'old', winnerPath: '/winner' }
  expect(experimentSitemapFilter('/original', m)).toBe(true)
})


test('sitemap matching normalises both the target and request paths', () => {
  const m = manifest([page({ arms: [
    { key: 'control', kind: 'control', weight: 0, pageTarget: '/original/' },
    { key: 'variantA', kind: 'variant', weight: 100, pageTarget: '/variant/' },
  ] })])
  expect(experimentSitemapFilter('/original', m)).toBe(true)
  expect(experimentSitemapFilter('/variant', m)).toBe(false)
})


test.each(['/old', '/old/'])('archived key /old/ matches normalised request %s', async path => {
  const m = manifest([])
  m.archivedPages['/old/'] = { slug: 'archived', winnerPath: '/winner' }
  expect(experimentSitemapFilter(path, m)).toBe(false)
})
