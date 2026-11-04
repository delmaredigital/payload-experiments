import type { Config } from 'payload'
import { expect, test } from 'vitest'
import { deny, isTrue, managedAccess, readOnlyAccess } from '../../src/collections/access.js'
import { createExperimentsPlugin } from '../../src/plugin.js'
import type { ExperimentsAccess, ExperimentsPluginOptions } from '../../src/types/contracts.js'
import { fakeReq } from '../_fakes/req.js'
import { invoke, sampleOptions } from '../collections/fixtures.js'
import { collectionOperations as operations, globalOperations } from './payloadOperations.js'

const req = fakeReq()
const callback = (result: unknown) => (async () => result) as ExperimentsAccess
const built = (options: ExperimentsPluginOptions) => createExperimentsPlugin(options)({ secret: 'test', db: {} as Config['db'] })

test.each([true, false, 'yes', {}])('every plugin operation enforces strict booleans (%j)', async value => {
  const options: ExperimentsPluginOptions = sampleOptions()
  options.access.manage = callback(value)
  const config = await built(options)
  for (const collection of config.collections ?? []) {
    for (const operation of operations) {
      expect(typeof collection.access?.[operation], `${collection.slug}.${operation}`).toBe('function')
      const managed = ['xp-experiments', 'xp-layers', 'xp-metrics'].includes(collection.slug)
      const expected = value !== true ? false
        : collection.slug === 'xp-experiments' && operation === 'delete' ? { status: { in: ['draft', 'archived'] } }
        : managed || operation === 'read'
      expect(await invoke(collection.access?.[operation], { req }), `${collection.slug}.${operation}`).toEqual(expected)
    }
  }
  for (const global of config.globals ?? []) {
    expect(Object.keys(global.access!).sort()).toEqual([...globalOperations].sort())
    for (const operation of globalOperations) {
      expect(await invoke(global.access?.[operation], { req }), `${global.slug}.${operation}`).toBe(value === true && operation === 'read')
    }
  }
})

test('readResults defaults to manage; readIdentities defaults to admin', async () => {
  const options = sampleOptions()
  options.access.admin = () => false
  const config = await built(options)
  for (const collection of config.collections ?? []) {
    expect(await invoke(collection.access?.read, { req }), collection.slug).toBe(!['xp-events', 'xp-identities'].includes(collection.slug))
  }
})

test.each([true, false, 'yes', {}])('explicit results and identities callbacks have independent strict access (%j)', async value => {
  const options: ExperimentsPluginOptions = sampleOptions()
  options.access = { manage: () => false, admin: () => false, readResults: callback(value), readIdentities: callback(value) }
  const config = await built(options)
  for (const collection of config.collections ?? []) {
    expect(await invoke(collection.access?.read, { req }), collection.slug).toBe(value === true && ['xp-phases', 'xp-results-snapshots', 'xp-events', 'xp-identities'].includes(collection.slug))
  }
})

test('managed operations and state read use manage independently of all other roles', async () => {
  const options: ExperimentsPluginOptions = sampleOptions()
  options.access = { manage: () => true, admin: () => false, readResults: () => false, readIdentities: () => false }
  const config = await built(options)
  for (const collection of config.collections ?? []) {
    const managed = ['xp-experiments', 'xp-layers', 'xp-metrics'].includes(collection.slug)
    for (const operation of operations) {
      const expected = collection.slug === 'xp-experiments' && operation === 'delete'
        ? { status: { in: ['draft', 'archived'] } } : managed
      expect(await invoke(collection.access?.[operation], { req }), `${collection.slug}.${operation}`).toEqual(expected)
    }
  }
  for (const global of config.globals ?? []) {
    expect(await invoke(global.access?.read, { req }), `${global.slug}.read`).toBe(true)
  }
})

test('root access helpers expose the collection implementation', async () => {
  expect(await invoke(isTrue(callback('yes')), { req })).toBe(false)
  expect(await invoke(isTrue(callback(true)), { req })).toBe(true)
  expect(await invoke(deny, { req })).toBe(false)
  expect(await invoke(managedAccess(sampleOptions()).update, { req })).toBe(true)
  expect(await invoke(readOnlyAccess(callback(true)).create, { req })).toBe(false)
})
