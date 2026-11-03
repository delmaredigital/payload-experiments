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

test.each([false, true])('the versions gate covers every collection and global the plugin adds (puck %s)', async puck => {
  const pluginOptions = sampleOptions()
  if (puck) pluginOptions.puck = { enabled: true, collections: ['pages'] }
  const config = await createExperimentsPlugin(pluginOptions)({
    secret: 'test', db: {} as Config['db'],
    collections: [{ slug: 'pages', fields: [] }],
    globals: [{ slug: 'settings', fields: [] }],
  })
  // Everything the plugin adds, whatever its slug: the built config minus the host's own entries.
  const added = [...config.collections!.filter(c => c.slug !== 'pages'), ...config.globals!.filter(g => g.slug !== 'settings')]
  expect(added.map(entry => entry.slug).sort()).toEqual(pluginConfigs.map(entry => entry.slug).sort())
  for (const entry of added) {
    expect(Object.prototype.hasOwnProperty.call(entry, 'versions'), entry.slug).toBe(true)
    expect(entry.versions, entry.slug).toEqual(entry.slug === 'xp-experiments' ? { drafts: false, maxPerDoc: 50 } : false)
  }
  expect(config.collections!.find(c => c.slug === 'pages')).not.toHaveProperty('versions')
})
