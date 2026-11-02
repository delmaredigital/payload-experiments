import { builtinModules } from 'node:module'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { collectImports } from '../_helpers/importGraph.js'

const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')))
function forbidden(name: string): boolean {
  // ADM-20 uses the public browser-safe URL formatter; the server entry remains forbidden.
  if (name === 'payload/shared') return false
  return builtins.has(name) || /^(?:@delmaredigital\/experiments-stats(?:\/|$)|pg(?:\/|$)|node:|payload(?:\/|$)|@payloadcms\/db-postgres(?:\/|$)|drizzle-orm(?:\/|$))/.test(name)
}
function forbiddenImports(imports: readonly string[]) { return imports.filter(forbidden) }

test('admin entry graph contains no statistics or server code', () => {
  const root = fileURLToPath(new URL('../../src/', import.meta.url))
  const graph = collectImports(fileURLToPath(new URL('../../src/exports/adminClient.ts', import.meta.url)))
  expect(forbiddenImports(graph.bare)).toEqual([])
  expect(graph.dynamic.filter(name => forbidden(name) || name.startsWith('<non-literal'))).toEqual([])
  expect(graph.files.map(file => relative(root, file).replaceAll('\\', '/')).filter(file =>
    /^(?:db|server|endpoints)\//.test(file) || file.startsWith('transitions/') && file !== 'transitions/confirmPhrases.ts',
  )).toEqual([])
})
test('the checker reports every planted forbidden import, including bare Node built-ins', () => {
  const fixtures = [
    ...builtinModules.flatMap(name => [name.replace(/^node:/, ''), `node:${name.replace(/^node:/, '')}`]),
    '@delmaredigital/experiments-stats', '@delmaredigital/experiments-stats/internal', 'pg', 'pg/lib', 'payload', 'payload/shared/internal',
    '@payloadcms/db-postgres', '@payloadcms/db-postgres/internal', 'drizzle-orm', 'drizzle-orm/pg-core',
  ]
  expect(forbiddenImports(fixtures)).toEqual(fixtures)
  expect(forbiddenImports(['@payloadcms/ui', '@payloadcms/ui/shared', 'payload/shared', 'react', 'next/navigation'])).toEqual([])
})

test('the admin entry includes the Tests surface and shell', () => {
  const graph = collectImports(fileURLToPath(new URL('../../src/exports/adminClient.ts', import.meta.url)))
  for (const name of ['TestsSurface', 'SurfaceShell', 'TestsHome']) expect(graph.files.some(file => file.endsWith(`/surface/${name}.tsx`))).toBe(true)
})
