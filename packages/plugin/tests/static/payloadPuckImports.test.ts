import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { collectImports } from '../_helpers/importGraph.js'

function sourceFiles(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
    return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

test('src never imports payload-puck, including type imports and re-exports', () => {
  const hits = sourceFiles(new URL('../../src/', import.meta.url)).flatMap(url => {
    // Only parse candidate files; collectImports covers static, dynamic and erased type edges.
    if (!readFileSync(url, 'utf8').includes('@delmaredigital/payload-puck')) return []
    const graph = collectImports(fileURLToPath(url), { includeTypes: true })
    return [...graph.bare, ...graph.dynamic].filter(name => /^@delmaredigital\/payload-puck(?:\/|$)/.test(name))
  })
  expect(hits).toEqual([])
})
