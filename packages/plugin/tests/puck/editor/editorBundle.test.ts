import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { collectImports } from '../../_helpers/importGraph.js'

test('/puck/editor cannot reach exposure, server, admin, or database code', () => {
  const graph = collectImports(fileURLToPath(new URL('../../../src/exports/puckEditor.ts', import.meta.url)))
  expect(graph.files.filter(file => /\/src\/(client|db|server|endpoints|admin)\//.test(file))).toEqual([])
  expect([...graph.bare, ...graph.dynamic].filter(name => /^(payload(?:\/|$)|@payloadcms\/|@delmaredigital\/experiments-stats(?:\/|$)|pg(?:\/|$)|node:)/.test(name))).toEqual([])
  expect(graph.dynamic).toEqual([])
})
