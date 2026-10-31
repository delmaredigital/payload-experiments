import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { collectImports } from '../_helpers/importGraph.js'

test.each(['proxy', 'runtimeProxy'])('%s value graph stays proxy-safe', name => {
  const entry = fileURLToPath(new URL(`../../src/exports/${name}.ts`, import.meta.url))
  const graph = collectImports(entry)
  expect([...graph.bare, ...graph.dynamic].filter(name => /^(payload(?:\/|$)|@payloadcms\/|react|@puckeditor\/|drizzle-orm)/.test(name))).toEqual([])
  expect(graph.files).toContain(entry)
})
