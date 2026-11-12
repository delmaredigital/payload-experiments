import { readFileSync, readdirSync } from 'node:fs'
import { basename, matchesGlob } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectImports } from '../_helpers/importGraph.js'
import ts from 'typescript'
import { expect, test, vi } from 'vitest'

// These scans parse every src file with the TypeScript compiler; give them room under a loaded full-suite run.
vi.setConfig({ testTimeout: 30_000 })

const src = new URL('../../src/', import.meta.url)
function imports(file: string) {
  return ts.createSourceFile(file, readFileSync(new URL(file, src), 'utf8'), ts.ScriptTarget.Latest, true).statements
    .filter(ts.isImportDeclaration)
}

const sharedStyles = ['ui/ui.css', 'testSurface/results/results.css', 'testSurface/surface/test/testPage.css']
const setupStyles = ['testSurface/surface/setting/setting.css', 'testSurface/surface/pagePicker/pagePicker.css']
// Admin tokens come from theme.css; the iframe/editor uses its self-contained token root.
const mounts = [
  ['admin/surface/test/TestPage.tsx', [...sharedStyles, ...setupStyles, 'admin/theme.css', 'admin/surface/surface.css']],
  ['admin/surface/ResultsRoute.tsx', [...sharedStyles, 'admin/theme.css', 'admin/surface/surface.css']],
  ['puck/editor/ConfigureTestDrawer.tsx', [...sharedStyles, ...setupStyles, 'puck/editor/editor.css']],
] as const

test.each(mounts)('%s loads every required stylesheet exactly once', (entry, required) => {
  // Follow value imports only, as the bundler does. Modules (including CSS) execute once
  // per resolved URL even when several components import the same stylesheet.
  const graph = collectImports(fileURLToPath(new URL(entry, src)))
  const css = graph.files.filter(file => file.endsWith('.css'))
  expect(css.sort()).toEqual(required.map(file => fileURLToPath(new URL(file, src))).sort())
  for (const file of required) {
    // Also catch a relocated duplicate under a different resolved URL.
    expect(css.filter(path => basename(path) === basename(file)), file).toHaveLength(1)
  }
  // No hidden CSS imports can introduce another copy outside this graph.
  for (const file of css) expect(readFileSync(file, 'utf8'), file).not.toMatch(/@import\b/)
})

test('the stylesheet entry loads CSS and no barrel has a bare side-effect import', () => {
  expect(imports('admin/surface/SurfaceShell.tsx').some(node => !node.importClause && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === '../theme.css')).toBe(true)
  for (const file of readdirSync(new URL('exports/', src)).filter(file => file.endsWith('.ts'))) {
    expect(imports(`exports/${file}`).filter(node => !node.importClause), file).toEqual([])
  }
})

// Preserve the JS owners too: pruning one loses its side-effect stylesheet import.
const styleEntries = [
  'dist/admin/surface/SurfaceShell.js', 'dist/admin/surface/ResultsRoute.js',
  'dist/testSurface/surface/test/TestSurface.js', 'dist/testSurface/surface/setting/parts.js',
  'dist/testSurface/surface/pagePicker/PageCombobox.js', 'dist/testSurface/results/DataTable.js',
  'dist/puck/editor/ConfigureTestDrawer.js', 'dist/ui/Drawer.js',
]
function preservesAdminStyles(metadata: { sideEffects?: unknown }): boolean {
  if (!Object.hasOwn(metadata, 'sideEffects') || metadata.sideEffects === true) return true
  if (!Array.isArray(metadata.sideEffects)) return false
  const patterns: unknown[] = metadata.sideEffects
  return [...new Set(mounts.flatMap(([, styles]) => styles.map(file => `dist/${file}`))), ...styleEntries].every(file =>
    patterns.some(pattern => {
      if (typeof pattern !== 'string') return false
      const glob = pattern.replace(/^\.\//, '')
      return matchesGlob(file, glob.includes('/') ? glob : `**/${glob}`)
    }))
}

test('package side-effect metadata preserves CSS and its JavaScript entry', () => {
  const metadata: { sideEffects?: unknown } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  expect(preservesAdminStyles(metadata), 'sideEffects must retain both shared CSS and its component entry').toBe(true)
})

test.each([
  [{}, true],
  [{ sideEffects: ['*.css'] }, false],
  [{ sideEffects: ['*.css', ...styleEntries] }, true],
  [{ sideEffects: ['*.css', './dist/testSurface/results/DataTable.js'] }, false],
  [{ sideEffects: true }, true],
  [{ sideEffects: false }, false],
  [{ sideEffects: ['dist/testSurface/results/DataTable.js'] }, false],
  [{ sideEffects: ['**/*.css', ...styleEntries] }, true],
  [{ sideEffects: ['dist/admin/*'] }, false],
  [{ sideEffects: [] }, false],
])('side-effect checker evaluates %j as %s', (metadata, expected) => {
  expect(preservesAdminStyles(metadata)).toBe(expected)
})
