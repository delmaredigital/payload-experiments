import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

interface ExportTarget { entry: string; exempt: boolean; targets: string[] }
const scriptURL = new URL('../../scripts/check-node-esm.mjs', import.meta.url)
// The module's direct-execution guard leaves dist untouched when helpers are imported.
const { NODE_ESM_EXEMPT_ENTRIES, isExemptEntry, listExportTargets } = await import(scriptURL.href) as {
  NODE_ESM_EXEMPT_ENTRIES: readonly string[]
  isExemptEntry(entry: string): boolean
  listExportTargets(exportsMap: Record<string, unknown>): ExportTarget[]
}
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

test('real export map exempts exactly the two CSS-bearing client entries', () => {
  const entries = listExportTargets(pkg.exports)
  expect(entries.map(({ entry }) => entry)).toEqual(Object.keys(pkg.exports).filter(entry => !['./package.json', './puck/editor.css', './puck/field.css'].includes(entry)))
  expect(entries.some(({ entry }) => entry === './package.json')).toBe(false)
  expect(entries.some(({ entry }) => entry === './puck/editor.css')).toBe(false)
  expect(entries.some(({ entry }) => entry === './puck/field.css')).toBe(false)
  expect(NODE_ESM_EXEMPT_ENTRIES).toEqual(['./admin/client', './puck/editor'])
  expect(entries.filter(({ exempt }) => exempt).map(({ entry }) => entry)).toEqual([...NODE_ESM_EXEMPT_ENTRIES])
  for (const { entry, targets } of entries) {
    expect(targets).toEqual([...new Set([pkg.exports[entry].import, pkg.exports[entry].default])])
    expect(targets.every(target => target.startsWith('./dist/'))).toBe(true)
  }
  for (const entry of ['.', './proxy', './runtime/proxy', './runtime/server', './rsc', './client', './admin/rsc', './admin', './puck']) {
    expect(isExemptEntry(entry)).toBe(false)
  }
  expect(entries.find(({ entry }) => entry === './puck')).toMatchObject({ exempt: false })
  expect(entries.find(({ entry }) => entry === './admin/rsc')).toEqual({
    entry: './admin/rsc', exempt: false, targets: ['./dist/exports/adminRsc.js'],
  })
})
test('selection only skips the exact package.json and public stylesheet mappings', () => {
  const entries = listExportTargets({ './other': './package.json', './package.json': './other.json',
    './other.css': './dist/puck/editor/editor.css', './puck/editor.css': './dist/puck/editor/other.css',
    './puck/field.css': './dist/puck/other.css',
  })
  expect(entries.map(({ entry }) => entry)).toEqual(['./other', './package.json', './other.css', './puck/editor.css', './puck/field.css'])
})
test('selection retains distinct import/default targets and checks any future server admin entry', () => {
  const entries = listExportTargets({ ...pkg.exports, './admin': {
    import: './dist/exports/admin.js', default: './dist/exports/admin-default.js',
    types: './dist/exports/admin.d.ts', '@delmaredigital/source': './src/exports/admin.ts',
  } })
  expect(entries.find(({ entry }) => entry === './admin')).toEqual({
    entry: './admin', exempt: false, targets: ['./dist/exports/admin.js', './dist/exports/admin-default.js'],
  })
})
