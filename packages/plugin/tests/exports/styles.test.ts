import { readFileSync, readdirSync } from 'node:fs'
import { matchesGlob } from 'node:path'
import ts from 'typescript'
import { expect, test, vi } from 'vitest'

// These scans parse every src file with the TypeScript compiler; give them room under a loaded full-suite run.
vi.setConfig({ testTimeout: 30_000 })

const src = new URL('../../src/', import.meta.url)
function imports(file: string) {
  return ts.createSourceFile(file, readFileSync(new URL(file, src), 'utf8'), ts.ScriptTarget.Latest, true).statements
    .filter(ts.isImportDeclaration)
}

test('results surface loads the shared admin stylesheet entry', () => {
  expect(imports('admin/surface/results/ResultsBody.tsx').some(node => !node.importClause && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === '../../styles.js')).toBe(true)
})

test('the stylesheet entry loads CSS and no barrel has a bare side-effect import', () => {
  expect(imports('admin/styles.ts').map(node => node.moduleSpecifier.getText())).toEqual(["'./styles.css'"])
  for (const file of readdirSync(new URL('exports/', src)).filter(file => file.endsWith('.ts'))) {
    expect(imports(`exports/${file}`).filter(node => !node.importClause), file).toEqual([])
  }
})

function preservesAdminStyles(metadata: { sideEffects?: unknown }): boolean {
  if (!Object.hasOwn(metadata, 'sideEffects') || metadata.sideEffects === true) return true
  if (!Array.isArray(metadata.sideEffects)) return false
  const patterns: unknown[] = metadata.sideEffects
  return ['dist/admin/styles.css', 'dist/admin/styles.js'].every(file =>
    patterns.some(pattern => {
      if (typeof pattern !== 'string') return false
      const glob = pattern.replace(/^\.\//, '')
      return matchesGlob(file, glob.includes('/') ? glob : `**/${glob}`)
    }))
}

test('package side-effect metadata preserves CSS and its JavaScript entry', () => {
  const metadata: { sideEffects?: unknown } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  expect(preservesAdminStyles(metadata), 'sideEffects must retain both dist/admin/styles.css and dist/admin/styles.js').toBe(true)
})

test.each([
  [{}, true],
  [{ sideEffects: ['*.css'] }, false],
  [{ sideEffects: ['*.css', './dist/admin/styles.js'] }, true],
  [{ sideEffects: true }, true],
  [{ sideEffects: false }, false],
  [{ sideEffects: ['dist/admin/styles.js'] }, false],
  [{ sideEffects: ['**/*.css', './dist/admin/styles.js'] }, true],
  [{ sideEffects: ['dist/admin/*'] }, true],
  [{ sideEffects: [] }, false],
])('side-effect checker evaluates %j as %s', (metadata, expected) => {
  expect(preservesAdminStyles(metadata)).toBe(expected)
})
