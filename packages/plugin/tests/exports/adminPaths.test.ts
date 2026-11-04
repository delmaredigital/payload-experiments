import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, test, vi } from 'vitest'

// These scans parse every src file with the TypeScript compiler; give them room under a loaded full-suite run.
vi.setConfig({ testTimeout: 30_000 })

const src = fileURLToPath(new URL('../../src/', import.meta.url))
const prefix = '@delmaredigital/payload-experiments/'
function parse(file: string) {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
}
function namedExports(barrel: string) { return new Set(parse(join(src, `exports/${barrel}.ts`)).statements.flatMap(statement =>
  ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.exportClause && ts.isNamedExports(statement.exportClause)
    ? statement.exportClause.elements.filter(element => !element.isTypeOnly).map(element => element.name.text) : [])) }
const exports = namedExports('adminClient')
const serverExports = namedExports('adminRsc')

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = join(directory, entry.name)
    return entry.isDirectory() ? files(file) : [file]
  })
}

test('every admin import-map string in src names a public admin export', () => {
  let count = 0
  for (const file of files(src)) {
    // Include strings in CSS and any future non-TypeScript source files too.
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/@delmaredigital\/payload-experiments\/admin\/client#([^\s'"`]+)/g)) {
      count++
      expect(exports.has(match[1]!), `${file}: unknown admin export ${match[1]}`).toBe(true)
    }
  }
  expect(count).toBeGreaterThan(0)
})

test('every XP_* path constant names a public admin export', () => {
  let count = 0
  function walk(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text.startsWith('XP_')) {
      count++
      expect(node.initializer && ts.isStringLiteral(node.initializer), node.name.text).toBe(true)
      if (node.initializer && ts.isStringLiteral(node.initializer)) {
        const [entry, symbol] = node.initializer.text.slice(prefix.length).split('#')
        expect(node.initializer.text.startsWith(prefix), node.name.text).toBe(true)
        expect(['admin/client', 'admin/rsc'], node.name.text).toContain(entry)
        expect((entry === 'admin/rsc' ? serverExports : exports).has(symbol!), node.name.text).toBe(true)
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(parse(join(src, 'admin/paths.ts')))
  expect(count).toBeGreaterThan(0)
})

// Explicit public-file inventory: adding a new public component means extending this gate.
test.each([
  'constants.ts', 'admin/paths.ts', 'admin/TestsNavLink.tsx', 'admin/views/TestsNavLinkServer.tsx', 'admin/TestsDashboardCards.tsx', 'admin/surface/TestsSurface.tsx',
  'admin/views/ExperimentsRootView.tsx', 'admin/views/CollectionListRedirect.tsx', 'admin/views/CollectionEditRedirect.tsx',
  'client/ExperimentsProvider.tsx', 'client/context.ts', 'client/useFlagPoint.ts', 'client/useExperiment.ts',
  'client/ExperimentPageview.tsx', 'client/beacon.ts', 'client/idempotency.ts', 'client/trackConversionBeacon.ts', 'client/ViewportExposure.tsx',
  'admin/MetricSourceSelect.tsx', 'admin/LayerUsage.tsx',
  'admin/armSelect/ArmSelectField.tsx',
  'puck/ExperimentSlot.tsx', 'puck/experimentSlotField.ts', 'puck/ExperimentPicker.tsx', 'puck/slot.model.ts', 'puck/copy.ts',
  'puck/editor/ExperimentSlotEditor.tsx', 'puck/editor/editor.model.ts', 'puck/editor/cloneSlot.ts', 'puck/editor/CreateExperimentDrawer.tsx',
  'fields/armSelect.ts',
])('%s has no placeholder marker', file => {
  expect(readFileSync(join(src, file), 'utf8')).not.toContain('// XP-PLACEHOLDER')
})
