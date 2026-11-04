import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, test } from 'vitest'

// Removed at CORE-44 handover, when the model imports the root export instead.
const allowList = new Set(['actions/actions.model.ts'])
const admin = fileURLToPath(new URL('../../src/admin/', import.meta.url))
function definitions(root: string): string[] {
  function visit(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) return visit(file)
      if (!/\.tsx?$/.test(file)) return []
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
      let defines = false
      function walk(node: ts.Node) {
        if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name && ts.isIdentifier(node.name) && node.name.text === 'contentDone') defines = true
        ts.forEachChild(node, walk)
      }
      walk(source)
      return defines && !allowList.has(relative(root, file)) ? [relative(root, file)] : []
    })
  }
  return visit(root)
}

test('admin imports contentDone instead of defining another copy', () => {
  expect(definitions(admin)).toEqual([])
})

test('the scan catches function and const definitions in a temporary file', () => {
  const root = mkdtempSync(join(tmpdir(), 'xp-content-done-'))
  try {
    for (const declaration of ['function contentDone() { return true }', 'const contentDone = () => true']) {
      writeFileSync(join(root, 'duplicate.ts'), declaration)
      expect(definitions(root)).toEqual(['duplicate.ts'])
    }
    writeFileSync(join(root, 'duplicate.ts'), "import { contentDone } from 'shared'")
    expect(definitions(root)).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
