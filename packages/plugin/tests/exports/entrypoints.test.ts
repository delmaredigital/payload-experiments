import { readFileSync, readdirSync } from 'node:fs'
import ts from 'typescript'
import { expect, test } from 'vitest'

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
    StatusCell: '../admin/StatusCell.js',
    SummaryCell: '../admin/SummaryCell.js',
    ExperimentActions: '../admin/actions/ExperimentActions.js',
    LockedFieldNotice: '../admin/LockedFieldNotice.js',
    FlagPointSelect: '../admin/FlagPointSelect.js',
    ArmsField: '../admin/arms/ArmsField.js',
    AllocationField: '../admin/AllocationField.js',
    TargetingAttributeField: '../admin/targeting/TargetingAttributeField.js',
    TargetingOpField: '../admin/targeting/TargetingOpField.js',
    TargetingValueField: '../admin/targeting/TargetingValueField.js',
    MetricSourceSelect: '../admin/MetricSourceSelect.js',
    ReviewPanel: '../admin/review/ReviewPanel.js',
    PhaseHistory: '../admin/PhaseHistory.js',
    LayerUsage: '../admin/LayerUsage.js',
    ResultsView: '../admin/results/ResultsView.js',
    ArmSelectField: '../admin/armSelect/ArmSelectField.js',
  },
  puck: {
    ExperimentSlot: '../puck/ExperimentSlot.js',
    createExperimentSlotField: '../puck/experimentSlotField.js',
    EXPERIMENT_SLOT_TYPE: '../types/puck.js',
  },
  puckEditor: { ExperimentSlotEditor: '../puck/editor/ExperimentSlotEditor.js' },
  index: { createArmSelectField: '../fields/armSelect.js' },
} as const
const requiredTypes = {
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
