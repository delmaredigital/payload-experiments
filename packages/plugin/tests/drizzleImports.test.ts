import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { expect, test } from 'vitest'

test('resolves the PGlite and Drizzle integration tools from the plugin package', async () => {
  const [orm, kit, pglite] = await Promise.all([
    import('drizzle-orm/pglite'),
    import('drizzle-kit/api'),
    import('@electric-sql/pglite'),
  ])

  expect(orm.drizzle).toBeTypeOf('function')
  expect(kit.pushSchema).toBeTypeOf('function')
  expect(pglite.PGlite).toBeTypeOf('function')
})

test('shares the same Drizzle ORM instance with Payload', () => {
  const pluginRequire = createRequire(new URL('../package.json', import.meta.url))
  const postgresRequire = createRequire(pluginRequire.resolve('@payloadcms/db-postgres'))
  const payloadDrizzleRequire = createRequire(postgresRequire.resolve('@payloadcms/drizzle'))

  expect(realpathSync(pluginRequire.resolve('drizzle-orm'))).toBe(
    realpathSync(payloadDrizzleRequire.resolve('drizzle-orm')),
  )
})
