import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { collectImports } from '../_helpers/importGraph.js'
const root = fileURLToPath(new URL('../../src/ui/', import.meta.url))
function files(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []) }
test('all UI modules, including type imports, stay Payload/admin/stats/server free', () => {
  for (const path of files(root)) {
    const graph = collectImports(path, { includeTypes: true })
    expect([...graph.bare, ...graph.dynamic].filter(name => /^(payload(?:\/|$)|@payloadcms\/|next(?:\/|$)|@delmaredigital\/experiments-stats(?:\/|$)|pg(?:\/|$)|node:)/.test(name)), path).toEqual([])
    expect(graph.files.filter(file => /\/src\/(admin|db|server)\//.test(file)), path).toEqual([])
    const text = readFileSync(path, 'utf8')
    expect(text, path).not.toMatch(/\brequire\s*\(/)
    if (/\buse(?:State|Effect|Ref|Id|Memo|Callback|Context)\s*\(/.test(text)) expect(text.startsWith("'use client'"), path).toBe(true)
    if (path === join(root, 'SelectControl.tsx')) {
      // /puck must stay importable in Node; its picker loads this client leaf
      // while admin/client and the generated editor stylesheet supply its CSS.
      expect(graph.files.filter(file => /\.css$/i.test(file)), path).toEqual([])
    } else if (path.endsWith('.tsx')) expect(text, path).toContain("import './ui.css'")
  }
})


test('SelectControl importers supply ui.css except the server-safe Puck picker and Inputs', () => {
  const src = fileURLToPath(new URL('../../src/', import.meta.url))
  const serverSafe = new Set(collectImports(join(src, 'exports/puck.ts')).files)
  const importers = files(src).filter(path => /['"][^'"]*\/SelectControl\.js['"]/.test(readFileSync(path, 'utf8')))
  expect(importers.length).toBeGreaterThan(0)
  for (const path of importers) {
    if (path === join(root, 'Inputs.tsx') || serverSafe.has(path)) continue
    expect(readFileSync(path, 'utf8'), path).toMatch(/import ['"][^'"]*ui\.css['"]/)
  }
})
