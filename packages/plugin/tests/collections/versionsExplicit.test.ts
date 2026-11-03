import type { Config } from 'payload'
import { expect, test } from 'vitest'
import { buildCollections } from '../../src/collections/index.js'
import { createExperimentsPlugin } from '../../src/plugin.js'
import { sampleOptions } from './fixtures.js'

const options = sampleOptions()
const { collections, globals } = buildCollections(options)
const pluginConfigs = [...collections, ...globals]

test.each(pluginConfigs)('$slug states its versions setting explicitly', config => {
  expect(Object.prototype.hasOwnProperty.call(config, 'versions')).toBe(true)
  expect(config.versions === false || (
    config.versions !== null && typeof config.versions === 'object'
  )).toBe(true)
  if (config.slug !== 'xp-experiments') expect(config.versions).toBe(false)
})

test('Tests retain their existing version history settings', () => {
  expect(collections.find(config => config.slug === 'xp-experiments')?.versions)
    .toEqual({ drafts: false, maxPerDoc: 50 })
})

test('the versions gate covers every xp- collection and global registered by the plugin', async () => {
  const config = await createExperimentsPlugin(options)({
    secret: 'test', db: {} as Config['db'],
    collections: [{ slug: 'pages', fields: [] }],
    globals: [{ slug: 'settings', fields: [] }],
  })
  const xpCollections = config.collections!.filter(collection => collection.slug.startsWith('xp-'))
  const xpGlobals = config.globals!.filter(global => global.slug.startsWith('xp-'))
  expect(xpCollections.map(collection => collection.slug).sort())
    .toEqual(collections.map(collection => collection.slug).sort())
  expect(xpGlobals.map(global => global.slug).sort())
    .toEqual(globals.map(global => global.slug).sort())
  for (const config of [...xpCollections, ...xpGlobals]) {
    expect(Object.prototype.hasOwnProperty.call(config, 'versions'), config.slug).toBe(true)
    expect(config.versions, config.slug).toEqual(
      config.slug === 'xp-experiments' ? { drafts: false, maxPerDoc: 50 } : false,
    )
  }
})
