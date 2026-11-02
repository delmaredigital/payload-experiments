import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import ts from 'typescript'
import { collectImports } from '../_helpers/importGraph.js'

const src = fileURLToPath(new URL('../../src/', import.meta.url))
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  })
}
function typeStatement(node: ts.Statement): boolean {
  if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) return true
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause
    const bindings = clause?.namedBindings
    return Boolean(clause?.isTypeOnly || !clause?.name && bindings && ts.isNamedImports(bindings)
      && bindings.elements.length > 0 && bindings.elements.every(item => item.isTypeOnly))
  }
  if (ts.isExportDeclaration(node)) return node.isTypeOnly || Boolean(node.exportClause && ts.isNamedExports(node.exportClause)
    && node.exportClause.elements.length > 0 && node.exportClause.elements.every(item => item.isTypeOnly))
  return false
}
function unreachable(entries: string[], inventory: string[]) {
  const reachable = new Set(entries.flatMap(entry => collectImports(entry, { includeTypes: true }).files))
  const valueReachable = new Set(entries.flatMap(entry => collectImports(entry).files))
  const source = inventory.filter(file => /\.tsx?$/.test(file))
  return {
    orphans: source.filter(file => !reachable.has(file)),
    runtimeOnlyThroughTypes: source.filter(file => reachable.has(file) && !valueReachable.has(file)
      && !ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true).statements.every(typeStatement)),
  }
}
test('admin source is reachable from public entries', () => {
  const entries = readdirSync(join(src, 'exports')).filter(file => file.endsWith('.ts')).map(file => join(src, 'exports', file))
  expect(unreachable(entries, files(join(src, 'admin')))).toEqual({ orphans: [], runtimeOnlyThroughTypes: [] })
})
test('an orphan fixture is reported', () => {
  const directory = mkdtempSync(join(tmpdir(), 'xp-admin-orphan-'))
  try {
    const fixture = join(directory, 'orphan.ts')
    writeFileSync(fixture, 'export const abandoned = true')
    expect(unreachable([], files(directory)).orphans).toEqual([fixture])
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
test('runtime code reached only through a type import is reported', () => {
  const directory = mkdtempSync(join(tmpdir(), 'xp-admin-type-orphan-'))
  try {
    const entry = join(directory, 'entry.ts'), dead = join(directory, 'DeadWidget.ts'), types = join(directory, 'types.ts')
    writeFileSync(entry, "import type { P } from './DeadWidget.js'; export type { T } from './types.js'")
    writeFileSync(dead, 'export type P = {}; export function DeadWidget() { return null }')
    writeFileSync(types, "import { type P } from './DeadWidget.js'; export { type P }; export interface T {}")
    expect(unreachable([entry], files(directory))).toEqual({ orphans: [], runtimeOnlyThroughTypes: [dead] })
    writeFileSync(entry, "export { DeadWidget } from './DeadWidget.js'; export type { T } from './types.js'")
    expect(unreachable([entry], files(directory))).toEqual({ orphans: [], runtimeOnlyThroughTypes: [] })
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
