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
