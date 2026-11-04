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

test('the Tests root reaches the surface only by import-map path', () => {
  const root = fileURLToPath(new URL('../../src/admin/views/ExperimentsRootView.tsx', import.meta.url))
  const graph = collectImports(root)
  expect(graph.files.some(file => file.endsWith('/surface/TestsSurface.tsx'))).toBe(false)
  expect(graph.bare).toContain('@payloadcms/ui/elements/RenderServerComponent')
  expect(graph.bare).not.toContain('@payloadcms/ui')
})

test('the Tests server nav reaches its client boundary only by import-map path', () => {
  const root = fileURLToPath(new URL('../../src/admin/views/TestsNavLinkServer.tsx', import.meta.url))
  const graph = collectImports(root)
  expect(graph.files.filter(file => hasClientDirective(readFileSync(file, 'utf8')))).toEqual([])
  expect(graph.bare).toContain('@payloadcms/ui/elements/RenderServerComponent')
  expect(graph.bare.some(name => name.startsWith('next/'))).toBe(false)
})

test('contentDone is pure and the admin result imports it without a server graph', () => {
  const helper = fileURLToPath(new URL('../../src/contentDone.ts', import.meta.url))
  const graph = collectImports(helper)
  expect(graph.bare).toEqual([])
  expect(graph.dynamic).toEqual([])
  expect(graph.files).toEqual([helper])
  const admin = collectImports(fileURLToPath(new URL('../../src/admin/actions/MakeContentResult.tsx', import.meta.url)))
  expect(admin.files).toContain(helper)
  expect(admin.files.filter(file => /\/src\/(db|server|endpoints|transitions)\//.test(file))).toEqual([])
  expect([...admin.bare, ...admin.dynamic].filter(name => /^(payload(?:\/|$)|pg(?:\/|$)|node:)/.test(name))).toEqual([])
})
