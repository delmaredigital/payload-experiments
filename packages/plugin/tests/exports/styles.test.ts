import { readFileSync, readdirSync } from 'node:fs'
import { matchesGlob } from 'node:path'
import ts from 'typescript'
import { expect, test } from 'vitest'

const src = new URL('../../src/', import.meta.url)
function imports(file: string) {
  return ts.createSourceFile(file, readFileSync(new URL(file, src), 'utf8'), ts.ScriptTarget.Latest, true).statements
    .filter(ts.isImportDeclaration)
}

test.each([
  ['admin/StatusCell.tsx', './styles.js'],
  ['admin/actions/ExperimentActions.tsx', '../styles.js'],
  ['admin/results/ResultsView.tsx', '../styles.js'],
])('%s loads the shared admin stylesheet entry', (file, specifier) => {
  expect(imports(file).some(node => !node.importClause && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === specifier)).toBe(true)
})

test('the stylesheet entry loads CSS and no barrel has a bare side-effect import', () => {
  expect(imports('admin/styles.ts').map(node => node.moduleSpecifier.getText())).toEqual(["'./styles.css'"])
  for (const file of readdirSync(new URL('exports/', src)).filter(file => file.endsWith('.ts'))) {
    expect(imports(`exports/${file}`).filter(node => !node.importClause), file).toEqual([])
  }
})

test('package side-effect metadata preserves CSS', () => {
  const metadata: { sideEffects?: unknown } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  if (!Object.hasOwn(metadata, 'sideEffects')) return
  expect(Array.isArray(metadata.sideEffects), 'sideEffects must list a CSS pattern').toBe(true)
  const patterns = metadata.sideEffects as unknown[]
  expect(patterns.some(pattern => typeof pattern === 'string' &&
    ['styles.css', 'src/admin/styles.css', 'dist/admin/styles.css'].some(file => matchesGlob(file, pattern))), 'sideEffects must retain *.css').toBe(true)
})
