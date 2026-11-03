import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { collectImports } from '../../_helpers/importGraph.js'

test('/puck/editor cannot reach exposure, server, admin, or database code', () => {
  const graph = collectImports(fileURLToPath(new URL('../../../src/exports/puckEditor.ts', import.meta.url)))
  expect(graph.files.filter(file => /\/src\/(client|db|server|endpoints|admin)\//.test(file))).toEqual([])
  expect([...graph.bare, ...graph.dynamic].filter(name => /^(payload(?:\/|$)|@payloadcms\/|@delmaredigital\/experiments-stats(?:\/|$)|pg(?:\/|$)|node:)/.test(name))).toEqual([])
  expect(graph.dynamic).toEqual([])
  expect(graph.files.some(file => /\/src\/ui\//.test(file))).toBe(true)
})

test('the editor render imports its shipped stylesheet', () => {
  const source = readFileSync(new URL('../../../src/puck/editor/ExperimentSlotEditor.tsx', import.meta.url), 'utf8')
  expect(source).toMatch(/import ['"]\.\/editor\.css['"]/)
  const css = readFileSync(new URL('../../../src/puck/editor/editor.css', import.meta.url), 'utf8')
  expect(css).not.toMatch(/@import/)
})
