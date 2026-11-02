import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { collectImports } from '../_helpers/importGraph.js'
import { hasClientDirective } from '../puck/clientDirective.js'

test.each(['proxy', 'runtimeProxy'])('%s value graph stays proxy-safe', name => {
  const entry = fileURLToPath(new URL(`../../src/exports/${name}.ts`, import.meta.url))
  const graph = collectImports(entry)
  expect([...graph.bare, ...graph.dynamic].filter(name => /^(payload(?:\/|$)|@payloadcms\/|react|@puckeditor\/|drizzle-orm)/.test(name))).toEqual([])
  expect(graph.files).toContain(entry)
})

test.each(['rsc'])('%s value graph stays server-only and free of Puck', name => {
  const entry = fileURLToPath(new URL(`../../src/exports/${name}.ts`, import.meta.url))
  const graph = collectImports(entry)
  expect([...graph.bare, ...graph.dynamic].filter(name => name.startsWith('@puckeditor/'))).toEqual([])
  expect(graph.files.filter(file => hasClientDirective(readFileSync(file, 'utf8')))).toEqual([])
  expect(graph.files).toContain(entry)
})
