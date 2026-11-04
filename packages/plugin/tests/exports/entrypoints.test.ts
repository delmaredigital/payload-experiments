import { readFileSync, readdirSync } from 'node:fs'
import ts from 'typescript'
import { expect, test, vi } from 'vitest'

// These scans parse every src file with the TypeScript compiler; give them room under a loaded full-suite run.
vi.setConfig({ testTimeout: 30_000 })

const required = {
  client: {
    ExperimentsProvider: '../client/ExperimentsProvider.js',
    useFlagPoint: '../client/useFlagPoint.js',
    useExperiment: '../client/useExperiment.js',
    ExperimentPageview: '../client/ExperimentPageview.js',
    trackConversionBeacon: '../client/trackConversionBeacon.js',
    MAX_EVENTS_PER_BODY: '../constants.js',
    DEFAULT_MAX_BODY_BYTES: '../constants.js',
  },
  adminClient: {
    XP_IF_UPDATED_AT_HEADER: '../constants.js',
    TestsSurface: '../admin/surface/TestsSurface.js',
    TestsDashboardCards: '../admin/TestsDashboardCards.js',
    TestsNavLink: '../admin/TestsNavLink.js',
    MetricSourceSelect: '../admin/MetricSourceSelect.js',
    LayerUsage: '../admin/LayerUsage.js',
    ArmSelectField: '../admin/armSelect/ArmSelectField.js',
  },
  puck: {
    ExperimentSlot: '../puck/ExperimentSlot.js',
    createExperimentSlot: '../puck/ExperimentSlot.js',
    createExperimentSlotField: '../puck/experimentSlotField.js',
    EXPERIMENT_SLOT_TYPE: '../types/puck.js',
  },
  rsc: { captureContentBaseline: '../hooks/contentChanges.js', compileManifest: '../manifest/compile.js' },
  adminRsc: {
    ExperimentsRootView: '../admin/views/ExperimentsRootView.js',
    CollectionListRedirect: '../admin/views/CollectionListRedirect.js',
    CollectionEditRedirect: '../admin/views/CollectionEditRedirect.js',
  },
  puckEditor: { ExperimentSlotEditor: '../puck/editor/ExperimentSlotEditor.js', createExperimentSlotEditor: '../puck/editor/ExperimentSlotEditor.js' },
  index: { createArmSelectField: '../fields/armSelect.js', contentDone: '../contentDone.js' },
} as const
const requiredTypes = {
  rsc: { MetricUnavailableReason: '../types/reasons.js', ContentReportReason: '../types/reasons.js', ManifestInputs: '../manifest/compile.js', ManifestInputExperiment: '../manifest/compile.js', ManifestPhase: '../manifest/compile.js', ManifestCompileOptions: '../manifest/compile.js', Manifest: '../types/manifest.js', ManifestExperiment: '../types/manifest.js' },
  index: { ContentReport: '../types/index.js', RestoreContentEntryBody: '../types/index.js', RestoreContentEntryResult: '../types/index.js', MetricUnavailableReason: '../types/index.js', ContentReportReason: '../types/index.js' },
  client: { ClientAssignments: '../types/assignments.js' },
  puck: {
    ExperimentSlotProps: '../types/puck.js',
    ExperimentRef: '../types/puck.js',
    ArmSlot: '../types/puck.js',
  },
} as const
const directory = new URL('../../src/exports/', import.meta.url)

function parse(file: string) {
  return ts.createSourceFile(file, readFileSync(new URL(file, directory), 'utf8'), ts.ScriptTarget.Latest, true)
}

function namedExports(source: ts.SourceFile, valuesOnly: boolean): Map<string, string> {
  return new Map(source.statements.flatMap(statement =>
    ts.isExportDeclaration(statement) && (!valuesOnly || !statement.isTypeOnly) &&
      statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.exportClause && ts.isNamedExports(statement.exportClause)
      ? statement.exportClause.elements.filter(element => !valuesOnly || !element.isTypeOnly)
        .map(element => [element.name.text, (statement.moduleSpecifier as ts.StringLiteral).text] as const) : []))
}

test.each(Object.entries(required))('%s exports every frozen runtime value from its source', (barrel, names) => {
  const exported = namedExports(parse(`${barrel}.ts`), true)
  for (const [name, source] of Object.entries(names)) expect(exported.get(name), `${barrel}: value export ${name}`).toBe(source)
})

test.each(Object.entries(requiredTypes))('%s exports every public type from its source', (barrel, names) => {
  const exported = namedExports(parse(`${barrel}.ts`), false)
  for (const [name, source] of Object.entries(names)) expect(exported.get(name), `${barrel}: type export ${name}`).toBe(source)
})

test.each([
  ["export { useFlagPoint } from '../client/useFlagPoint.js'", true],
  ["export type { useFlagPoint } from '../client/useFlagPoint.js'", false],
  ["export { type useFlagPoint } from '../client/useFlagPoint.js'", false],
  ["export { useFlagPoint } from '../client/useExperiment.js'", false],
])('runtime export checker evaluates %s as %s', (text, expected) => {
  const source = ts.createSourceFile('barrel.ts', text, ts.ScriptTarget.Latest, true)
  expect(namedExports(source, true).get('useFlagPoint') === '../client/useFlagPoint.js').toBe(expected)
})

test('the type export checker permits declaration and inline type-only exports', () => {
  for (const text of [
    "export type { ClientAssignments } from '../types/assignments.js'",
    "export { type ClientAssignments } from '../types/assignments.js'",
  ]) {
    const source = ts.createSourceFile('barrel.ts', text, ts.ScriptTarget.Latest, true)
    expect(namedExports(source, false).get('ClientAssignments')).toBe('../types/assignments.js')
  }
})

test('every barrel uses explicit named exports, never export *', () => {
  for (const file of readdirSync(directory).filter(file => file.endsWith('.ts'))) {
    for (const statement of parse(file).statements) {
      if (ts.isExportDeclaration(statement)) {
        expect(statement.exportClause && ts.isNamedExports(statement.exportClause), `${file}: export * is forbidden`).toBe(true)
      }
    }
  }
})

test('captureContentBaseline is the same wrapped hook installed by the plugin', async () => {
  const { captureContentBaseline } = await import('../../src/exports/rsc.js')
  const { contentChangesBeforeHook } = await import('../../src/hooks/contentChanges.js')
  expect(captureContentBaseline).toBe(contentChangesBeforeHook)
})
