import type { Config } from 'payload'
import { expect, test } from 'vitest'
import { createExperimentsPlugin } from '../../src/plugin.js'
import { pageGuardAfterChange, pageGuardBeforeChange, pageGuardEnterOperation, pageGuardBeforeOperation, pageGuardAfterOperation, pageGuardBeforeDelete } from '../../src/hooks/pageGuard.js'
import { contentChangesBeforeHook, contentChangesHook } from '../../src/hooks/contentChanges.js'
import { sampleOptions } from '../collections/fixtures.js'

test('capture installs only on configured and enabled Puck collections', async () => {
  const options = sampleOptions()
  options.puck = { enabled: true, collections: ['pages'] }
  const asks = { slug: 'asks', fields: [], versions: { drafts: {} } }
  const config = await createExperimentsPlugin(options)({ secret: 'test', db: {} as Config['db'], collections: [
    { slug: 'pages', fields: [], versions: { drafts: {} } }, asks,
  ] })
  expect(config.collections?.[2]?.hooks?.beforeChange).toEqual([pageGuardBeforeChange, contentChangesBeforeHook, expect.any(Function)])
  expect(config.collections?.[2]?.hooks?.afterChange).toEqual([pageGuardAfterChange, contentChangesHook])
  expect(config.collections?.[3]).toBe(asks)
  options.puck.enabled = false
  const disabled = await createExperimentsPlugin(options)({ secret: 'test', db: {} as Config['db'], collections: [asks, { slug: 'pages', fields: [] }] })
  expect(disabled.collections?.[2]).toBe(asks)
  expect(disabled.collections?.[3]?.hooks?.beforeChange).toBeUndefined()
})

test.each(['puck', 'blocks'] as const)('%s-only receives guard and audit hooks without page status', async kind => {
  const options = sampleOptions()
  if (kind === 'puck') options.puck = { enabled: true, collections: ['pages'] }
  else options.blocks = { collections: [{ slug: 'pages', field: 'layout' }] }
  const config = await createExperimentsPlugin(options)({ collections: [{ slug: 'pages', fields: [] }] } as unknown as Config)
  const collection = config.collections![2]!
  expect(collection.fields).toEqual([])
  expect(collection.hooks).toEqual({ beforeChange: [pageGuardBeforeChange, contentChangesBeforeHook, ...(kind === 'puck' ? [expect.any(Function)] : [])], afterChange: [pageGuardAfterChange, contentChangesHook], beforeOperation: [pageGuardEnterOperation, pageGuardBeforeOperation], afterOperation: [pageGuardAfterOperation], beforeDelete: [pageGuardBeforeDelete] })
})
