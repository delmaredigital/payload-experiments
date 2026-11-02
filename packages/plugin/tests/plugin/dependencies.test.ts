import { expect, test } from 'vitest'
import { createExperimentsPlugin } from '../../src/plugin.js'
import { XP_TESTS_SURFACE } from '../../src/admin/paths.js'
import { sampleOptions } from '../collections/fixtures.js'

test('Tests surface import-map dependency is registered and host dependencies survive', async () => {
  const host = { path: '@host/admin#HostWidget', type: 'component' as const }
  const config = await createExperimentsPlugin(sampleOptions())({
    secret: 'test-only', db: {} as Config['db'], collections: [{ slug: 'pages', fields: [] }],
    admin: { dependencies: { hostWidget: host } },
  })
  expect(config.admin?.dependencies?.xpTestsSurface).toEqual({ path: XP_TESTS_SURFACE, type: 'component' })
  expect(config.admin?.dependencies?.hostWidget).toEqual(host)
})
import type { Config } from 'payload'
