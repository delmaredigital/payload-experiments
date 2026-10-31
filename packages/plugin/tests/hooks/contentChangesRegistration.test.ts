import type { Config } from 'payload'
import { expect, test } from 'vitest'
import { createExperimentsPlugin } from '../../src/plugin.js'
import { contentChangesBeforeHook, contentChangesHook } from '../../src/hooks/contentChanges.js'
import { sampleOptions } from '../collections/fixtures.js'

test('capture installs only on configured and enabled Puck collections', async () => {
  const options = sampleOptions()
  options.puck = { enabled: true, collections: ['pages'] }
  const asks = { slug: 'asks', fields: [], versions: { drafts: {} } }
  const config = await createExperimentsPlugin(options)({ secret: 'test', db: {} as Config['db'], collections: [
    { slug: 'pages', fields: [], versions: { drafts: {} } }, asks,
  ] })
  expect(config.collections?.[0]?.hooks?.beforeChange).toEqual([contentChangesBeforeHook])
  expect(config.collections?.[0]?.hooks?.afterChange).toEqual([contentChangesHook])
  expect(config.collections?.[1]).toBe(asks)
  options.puck.enabled = false
  const disabled = await createExperimentsPlugin(options)({ secret: 'test', db: {} as Config['db'], collections: [asks, { slug: 'pages', fields: [] }] })
  expect(disabled.collections?.[0]).toBe(asks)
  expect(disabled.collections?.[1]?.hooks?.beforeChange).toBeUndefined()
})
