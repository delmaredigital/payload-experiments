import { expect, test } from 'vitest'
import { buildCollections } from '../../src/collections/index.js'
import { fakeReq } from '../_fakes/req.js'
import { collectionOperations as operations, globalOperations } from '../access/payloadOperations.js'
import { invoke, sampleOptions } from './fixtures.js'

const req = fakeReq()
test('every supported collection and global access operation is explicit', () => {
  const { collections, globals } = buildCollections(sampleOptions())
  for (const config of collections) for (const op of operations) expect(typeof config.access?.[op], `${config.slug}.${op}`).toBe('function')
  for (const global of globals) expect(Object.keys(global.access!).sort()).toEqual([...globalOperations].sort())
})
test.each([true, false, 'yes', {}])('strict manage result %j and delete Where', async result => {
  const options = sampleOptions()
  // Exercise a misbehaving JS host despite the boolean TypeScript contract.
  options.access.manage = (() => result) as unknown as typeof options.access.manage
  const { collections, globals } = buildCollections(options)
  for (const collection of collections) {
    for (const op of operations) {
      const actual = await invoke(collection.access?.[op], { req })
      const managed = ['xp-experiments', 'xp-layers', 'xp-metrics'].includes(collection.slug)
      const expected = result !== true ? false : collection.slug === 'xp-experiments' && op === 'delete' ? { status: { in: ['draft', 'archived'] } }
        : managed || op === 'read'
      expect(actual, `${collection.slug}.${op}`).toEqual(expected)
    }
  }
  expect(await invoke(globals[0]!.access?.read, { req })).toBe(result === true)
  expect(await invoke(globals[0]!.access?.update, { req })).toBe(false)
  expect(await invoke(globals[0]!.access?.readVersions, { req })).toBe(false)
})
test('readResults and readIdentities are independent of manage', async () => {
  const options = sampleOptions()
  options.access = { manage: () => false, readResults: async () => true, readIdentities: () => true }
  const { collections } = buildCollections(options)
  for (const collection of collections) expect(await invoke(collection.access?.read, { req })).toBe(['xp-phases', 'xp-events', 'xp-identities', 'xp-results-snapshots'].includes(collection.slug))
})
test('readIdentities defaults to admin before manage', async () => {
  const options = sampleOptions()
  options.access.admin = () => false
  const { collections } = buildCollections(options)
  for (const slug of ['xp-events', 'xp-identities']) expect(await invoke(collections.find(c => c.slug === slug)?.access?.read, { req })).toBe(false)
})
