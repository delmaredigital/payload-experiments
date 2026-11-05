import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { collectImports } from '../_helpers/importGraph.js'

test.each(['TestsSurface', 'ResultsRoute'])('%s never reaches Payload UI', entry => {
  const graph = collectImports(fileURLToPath(new URL(`../../src/admin/surface/${entry}.tsx`, import.meta.url)))
  expect([...graph.bare, ...graph.dynamic].filter(specifier => specifier === '@payloadcms/ui' || specifier.startsWith('@payloadcms/ui/'))).toEqual([])
})
