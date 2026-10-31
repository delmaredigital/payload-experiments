import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { collectImports } from '../_helpers/importGraph.js'

test('admin entry graph contains no statistics or server code', () => {
  const root = fileURLToPath(new URL('../../src/', import.meta.url))
  const graph = collectImports(fileURLToPath(new URL('../../src/exports/adminClient.ts', import.meta.url)))
  const forbidden = (name: string) => /^(?:@delmaredigital\/experiments-stats(?:\/|$)|pg(?:\/|$)|node:|payload(?:\/|$))/.test(name)
  expect(graph.bare.filter(forbidden)).toEqual([])
  expect(graph.dynamic.filter(name => forbidden(name) || name.startsWith('<non-literal'))).toEqual([])
  expect(graph.files.map(file => relative(root, file).replaceAll('\\', '/')).filter(file =>
    /^(?:db|server|endpoints)\//.test(file) || file.startsWith('transitions/') && file !== 'transitions/confirmPhrases.ts',
  )).toEqual([])
})
