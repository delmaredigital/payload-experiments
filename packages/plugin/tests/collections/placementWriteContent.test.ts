import { expect, test, vi } from 'vitest'
import { placementMergeBase, placementWriteContent } from '../../src/db/appends.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'

test.each([
  [{}, 'latest'],
  [{ versionId: 7 }, 'restore'],
  [{ publishSpecificLocale: 'fr' }, 'published'],
  [{ localizeStatus: true }, 'main'],
  [{ localizeStatus: true, allLocales: true }, 'latest'],
  [{ localizeStatus: true, draft: true }, 'latest'],
  [{ localizeStatus: true, draft: true, status: 'published' }, 'main'],
  [{ bulk: true }, 'main'],
  [{ bulk: true, draft: true }, 'latest'],
  [{ bulk: true, trashing: true }, 'latest'],
  [{ bulk: true, publishSpecificLocale: 'fr' }, 'published'],
  [{ localizeStatus: true, publishSpecificLocale: 'fr' }, 'main'],
] as const)('save path %j selects %s', (path, base) => {
  expect(placementMergeBase(path)).toBe(base)
})

test.each(['latest', 'published', 'restore', 'main'] as const)('%s merge reads the matching Payload base', async base => {
  const payload = fakePayload({ config: { collections: [{ slug: 'pages', versions: { drafts: true } }] } })
  const main = { id: 1, title: 'Main' }, version = { title: 'Version' }
  const read = vi.fn(async () => ({ docs: [{ version }] })); Object.assign(payload.db, { findVersions: read })
  const path = base === 'restore' ? { versionId: 7 } : base === 'published' ? { publishSpecificLocale: 'fr' } : base === 'main' ? { bulk: true } : {}
  expect(await placementWriteContent(fakeReq({ payload }), 'pages', 1, main, path)).toEqual(base === 'main' ? main : { ...version, id: 1 })
  if (base === 'main') expect(read).not.toHaveBeenCalled()
  else expect(read).toHaveBeenCalledWith(expect.objectContaining({ sort: '-updatedAt', where: base === 'restore' ? { id: { equals: 7 } }
    : { and: [{ parent: { equals: 1 } }, base === 'published' ? { 'version._status': { equals: 'published' } } : { latest: { equals: true } }] } }))
  read.mockResolvedValue({ docs: [] })
  expect(await placementWriteContent(fakeReq({ payload }), 'pages', 1, main, path)).toEqual(base === 'published' ? undefined : main)
})
