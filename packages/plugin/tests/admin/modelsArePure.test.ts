import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, test } from 'vitest'

function models(directory: URL): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
    return entry.isDirectory() ? models(url) : entry.name.endsWith('.model.ts') ? [fileURLToPath(url)] : []
  })
}
test('all models are free of React, Payload UI and Next imports, including types', () => {
  const violations: string[] = []
  for (const file of models(new URL('../../src/', import.meta.url))) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    // A model must stay framework-free even if a new import syntax is used.
    function walk(node: ts.Node) {
      if (ts.isStringLiteralLike(node) && /^(?:react(?:-dom)?(?:\/|$)|@payloadcms\/|next(?:\/|$))/.test(node.text)) {
        violations.push(`${file}: ${node.text}`)
      }
      ts.forEachChild(node, walk)
    }
    walk(source)
  }
  expect(violations).toEqual([])
})
