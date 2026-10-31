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
