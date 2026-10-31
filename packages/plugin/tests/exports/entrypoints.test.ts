import { readFileSync, readdirSync } from 'node:fs'
import ts from 'typescript'
import { expect, test } from 'vitest'

const required = {
  client: ['ExperimentsProvider', 'useFlagPoint', 'useExperiment', 'ExperimentPageview', 'trackConversionBeacon', 'MAX_EVENTS_PER_BODY', 'DEFAULT_MAX_BODY_BYTES'],
  adminClient: ['StatusCell', 'SummaryCell', 'ExperimentActions', 'LockedFieldNotice', 'FlagPointSelect', 'ArmsField', 'AllocationField', 'TargetingAttributeField', 'TargetingOpField', 'TargetingValueField', 'MetricSourceSelect', 'ReviewPanel', 'PhaseHistory', 'LayerUsage', 'ResultsView', 'ArmSelectField'],
  puck: ['ExperimentSlot', 'createExperimentSlotField', 'ExperimentSlotProps', 'ExperimentRef', 'ArmSlot'],
  puckEditor: ['ExperimentSlotEditor'],
  index: ['createArmSelectField'],
} as const
const directory = new URL('../../src/exports/', import.meta.url)

function parse(file: string) {
  return ts.createSourceFile(file, readFileSync(new URL(file, directory), 'utf8'), ts.ScriptTarget.Latest, true)
}

test.each(Object.entries(required))('%s exports every frozen public name', (barrel, names) => {
  const exported = parse(`${barrel}.ts`).statements.flatMap(statement =>
    ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)
      ? statement.exportClause.elements.map(element => element.name.text) : [])
  for (const name of names) expect(exported, `${barrel}: missing export ${name}`).toContain(name)
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
