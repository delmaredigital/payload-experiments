import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { collectImports } from '../_helpers/importGraph.js'

const entry = (name: string) => fileURLToPath(new URL(`../../src/exports/${name}.ts`, import.meta.url))
const proxyForbidden = /^(payload(?:\/|$)|@payloadcms\/|react|@puckeditor\/)/
const clientForbidden = /^(payload(?:\/|$)|@payloadcms\/|@puckeditor\/core(?:\/|$)|@delmaredigital\/experiments-stats(?:\/|$)|pg(?:\/|$)|node:)/

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
})
