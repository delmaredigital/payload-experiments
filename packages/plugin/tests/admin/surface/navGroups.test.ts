import { createLocalReq, sanitizeConfig } from 'payload'
import type { Config, SanitizedConfig, SanitizedPermissions } from 'payload'
import { EntityType, groupNavItems } from '@payloadcms/ui/shared'
import { beforeAll, expect, test } from 'vitest'
import { createExperimentsPlugin } from '../../../src/plugin.js'
import { sampleOptions } from '../../collections/fixtures.js'
import { fakePayload } from '../../_fakes/payload.js'

let config: SanitizedConfig
beforeAll(async () => {
  const options = sampleOptions()
  options.access.manage = ({ req }) => req.user?.role === 'manager'
  config = await sanitizeConfig(await createExperimentsPlugin(options)({
    secret: 'test-only', db: {} as Config['db'],
    collections: [{ slug: 'pages', fields: [], admin: { group: 'Content' } }, { slug: 'editors', auth: true, fields: [] }],
    globals: [{ slug: 'settings', fields: [] }],
  }))
})

test.each([true, false])('built config uses real Payload read permissions to group Tests for manager=%s', async manager => {
  expect(config.collections.slice(0, 3).map(item => item.slug)).toEqual(['xp-experiments', 'xp-metrics', 'pages'])
  expect(config.admin.user).toBe('editors')
  const req = await createLocalReq({ user: { id: 1, collection: 'editors', role: manager ? 'manager' : 'reader' } }, fakePayload({ config }))
  const permissions: SanitizedPermissions = { collections: Object.fromEntries(await Promise.all(config.collections.map(async collection => [collection.slug, {
    fields: {}, ...(await collection.access.read({ req }) === true ? { read: true as const } : {}),
  }]))), globals: { settings: { fields: {}, read: true } } }
  const groups = groupNavItems([
    ...config.collections.map(entity => ({ entity, type: EntityType.collection as const })),
    ...config.globals.map(entity => ({ entity, type: EntityType.global as const })),
  ], permissions, req.i18n)
  if (manager) {
    expect(groups.map(group => group.label)).toEqual(['Collections', 'Globals', 'Tests', 'Content'])
    expect(groups[2]!.entities.map(entity => entity.label)).toEqual(['All tests', 'Goals'])
    expect(groups[2]!.entities.map(entity => entity.slug)).toEqual(['xp-experiments', 'xp-metrics'])
  } else expect(groups.some(group => group.label === 'Tests')).toBe(false)
})
