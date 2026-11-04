import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { collectImports } from '../_helpers/importGraph.js'
import { hasClientDirective } from '../puck/clientDirective.js'

const entry = (name: string) => fileURLToPath(new URL(`../../src/exports/${name}.ts`, import.meta.url))
const proxyForbidden = /^(payload(?:\/|$)|@payloadcms\/|react|@puckeditor\/)/
const clientForbidden = /^(payload(?:\/|$)|@payloadcms\/|@puckeditor\/core(?:\/|$)|@delmaredigital\/experiments-stats(?:\/|$)|pg(?:\/|$)|node:)/

// Route handlers import these entries; Next 16's app-route layer has no vendored app-router-context.
const adminEntries = ['adminClient', 'adminRsc']
const routeSafeEntries = readdirSync(fileURLToPath(new URL('../../src/exports/', import.meta.url))).filter(file => file.endsWith('.ts')).map(file => file.slice(0, -3)).filter(name => !adminEntries.includes(name))

test('every non-admin entry is checked for next/navigation', () => {
  expect(routeSafeEntries.sort()).toEqual(['client', 'index', 'proxy', 'puck', 'puckEditor', 'rsc', 'runtimeProxy', 'runtimeServer'])
})

test.each(routeSafeEntries)('%s has no next/navigation value imports', name => {
  const graph = collectImports(entry(name))
  expect([...graph.bare, ...graph.dynamic].filter(name => /^next\/(?:navigation(?:[/.]|$)|dist\/)/.test(name))).toEqual([])
})

test('adminRsc eagerly imports only server modules and loads its themed message through a client boundary', () => {
  const graph = collectImports(entry('adminRsc'))
  const eager = collectImports(entry('adminRsc'), { followDynamic: false })
  const message = fileURLToPath(new URL('../../src/admin/components/RootViewMessage.tsx', import.meta.url))
  expect([...graph.bare, ...graph.dynamic].filter(name => name.startsWith('@puckeditor/'))).toEqual([])
  expect(eager.files.filter(file => hasClientDirective(readFileSync(file, 'utf8')) || /\.(css|scss)$/.test(file))).toEqual([])
  expect(graph.files.filter(file => hasClientDirective(readFileSync(file, 'utf8')))).toEqual([message])
  expect(graph.dynamic).toContain('../components/RootViewMessage.js')
  expect(collectImports(message).files).toContain(fileURLToPath(new URL('../../src/admin/theme.css', import.meta.url)))
  expect(graph.files).toContain(entry('adminRsc'))
})

test('rsc does not reach admin views', () => {
  expect(collectImports(entry('rsc')).files.filter(file => file.includes('/src/admin/views/'))).toEqual([])
})

test.each(['proxy', 'runtimeProxy'])('%s has a proxy-safe value import graph', name => {
  const graph = collectImports(entry(name))
  expect([...graph.bare, ...graph.dynamic].filter(name => proxyForbidden.test(name))).toEqual([])
  expect(graph.files).toContain(entry(name))
})

test('TSX with JSX records the implicit React runtime edge, including through relative imports', () => {
  const dir = mkdtempSync(join(tmpdir(), 'xp-tsx-graph-'))
  try {
    writeFileSync(join(dir, 'entry.ts'), `export { Component } from './component.js'`)
    writeFileSync(join(dir, 'component.tsx'), 'export const Component = () => <><div /></>')
    writeFileSync(join(dir, 'no-jsx.tsx'), 'export const value = 1')
    expect(collectImports(join(dir, 'entry.ts')).bare).toContain('react/jsx-runtime')
    expect(collectImports(join(dir, 'component.tsx')).bare).toEqual(['react/jsx-runtime'])
    expect(collectImports(join(dir, 'no-jsx.tsx')).bare).toEqual([])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('client has no server, Payload, Puck or statistics value imports', () => {
  const graph = collectImports(entry('client'))
  expect([...graph.bare, ...graph.dynamic].filter(name => clientForbidden.test(name))).toEqual([])
  expect(graph.files.filter(file => /\/src\/(db|server|endpoints)\//.test(file))).toEqual([])
})

test('graph elides type edges, walks re-exports and cycles, and records dynamic imports separately', () => {
  const dir = mkdtempSync(join(tmpdir(), 'xp-import-graph-'))
  try {
    writeFileSync(join(dir, 'entry.ts'), `
      import type { A } from 'payload'
      export type { B } from '@payloadcms/ui'
      import { type C } from 'pg'
      export { type D } from '@puckeditor/core'
      import { type E, value } from 'mixed-package'
      export { thing } from './nested.js'
      import './side-effect.js'
      const later = import('dynamic-package')
      const local = import('./dynamic.js')
    `)
    writeFileSync(join(dir, 'nested.ts'), `export { value } from './entry.js'; import 'nested-package'`)
    writeFileSync(join(dir, 'side-effect.ts'), `import '@delmaredigital/experiments-stats'`)
    writeFileSync(join(dir, 'dynamic.ts'), `import 'dynamic-child'`)
    const graph = collectImports(join(dir, 'entry.ts'))
    expect(graph.bare).toEqual(['@delmaredigital/experiments-stats', 'dynamic-child', 'mixed-package', 'nested-package'])
    expect(graph.dynamic).toEqual(['./dynamic.js', 'dynamic-package'])
    const eager = collectImports(join(dir, 'entry.ts'), { followDynamic: false })
    expect(eager.dynamic).toEqual(graph.dynamic)
    expect(eager.files).not.toContain(join(dir, 'dynamic.ts'))
    expect(eager.bare).not.toContain('dynamic-child')
    expect(graph.files).toContain(join(dir, 'nested.ts'))
    expect(graph.files).toContain(join(dir, 'dynamic.ts'))
    expect(graph.files.some(file => file.endsWith('/stats/src/index.ts'))).toBe(true)
    expect(new Set(graph.files).size).toBe(graph.files.length)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a relative non-code asset import is a recorded leaf, not a parse error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'xp-graph-css-'))
  try {
    writeFileSync(join(dir, 'styles.css'), '.x { color: red }\n')
    writeFileSync(join(dir, 'entry.ts'), "import './styles.css'\nexport const a = 1\n")
    const graph = collectImports(join(dir, 'entry.ts'))
    expect(graph.files).toContain(join(dir, 'styles.css'))
    expect(graph.bare).toEqual([])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})


test('every Next subpath value import in src has a Node ESM extension', () => {
  const root = fileURLToPath(new URL('../../src/', import.meta.url))
  const imports = new Set<string>()
  for (const file of readdirSync(root, { recursive: true })) {
    if (!/\.tsx?$/.test(String(file))) continue
    const graph = collectImports(join(root, String(file)))
    for (const value of [...graph.bare, ...graph.dynamic]) if (value.startsWith('next/')) imports.add(value)
  }
  expect([...imports].filter(value => !/\.(?:js|mjs|cjs|json)$/.test(value))).toEqual([])
}, 30_000)

test('rsc reaches the host SEO contract fixture', () => {
  expect(collectImports(entry('rsc')).files).toContain(fileURLToPath(new URL('../../src/server/pageKindSeoContract.ts', import.meta.url)))
})
