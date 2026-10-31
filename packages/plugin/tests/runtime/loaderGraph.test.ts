import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { collectImports } from '../_helpers/importGraph.js'

test('runtimeProxy loader graph contains no Payload adapter or Drizzle runtime imports', () => {
  const entry = fileURLToPath(new URL('../../src/exports/runtimeProxy.ts', import.meta.url))
  const graph = collectImports(entry)
  expect([...graph.bare, ...graph.dynamic].filter(name => /^(payload(?:\/|$)|@payloadcms\/|drizzle-orm)/.test(name))).toEqual([])
  expect(graph.files.some(file => file.endsWith('/db/pgExecutor.ts'))).toBe(true)
  expect(graph.files.some(file => file.endsWith('/db/executor.ts'))).toBe(false)
})
