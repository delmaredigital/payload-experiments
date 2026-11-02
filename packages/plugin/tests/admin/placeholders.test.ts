import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import * as paths from '../../src/admin/paths.js'
const admin = [
  ['XP_TESTS_SURFACE', 'TestsSurface', 'surface/TestsSurface'],
  ['XP_TESTS_NAV_LINK', 'TestsNavLink', 'TestsNavLink'],
  ['XP_STATUS_CELL', 'StatusCell', 'StatusCell'], ['XP_SUMMARY_CELL', 'SummaryCell', 'SummaryCell'],
  ['XP_ACTIONS', 'ExperimentActions', 'actions/ExperimentActions'], ['XP_LOCKED_NOTICE', 'LockedFieldNotice', 'LockedFieldNotice'],
  ['XP_FLAG_POINT_SELECT', 'FlagPointSelect', 'FlagPointSelect'], ['XP_ARMS_FIELD', 'ArmsField', 'arms/ArmsField'],
  ['XP_ALLOCATION_FIELD', 'AllocationField', 'AllocationField'], ['XP_TARGETING_ATTRIBUTE', 'TargetingAttributeField', 'targeting/TargetingAttributeField'],
  ['XP_TARGETING_OP', 'TargetingOpField', 'targeting/TargetingOpField'], ['XP_TARGETING_VALUE', 'TargetingValueField', 'targeting/TargetingValueField'],
  ['XP_METRIC_SOURCE_SELECT', 'MetricSourceSelect', 'MetricSourceSelect'], ['XP_REVIEW_PANEL', 'ReviewPanel', 'review/ReviewPanel'],
  ['XP_PHASE_HISTORY', 'PhaseHistory', 'PhaseHistory'], ['XP_LAYER_USAGE', 'LayerUsage', 'LayerUsage'],
  ['XP_RESULTS_VIEW', 'ResultsView', 'results/ResultsView'], ['XP_ARM_SELECT', 'ArmSelectField', 'armSelect/ArmSelectField'],
] as const
const views = [
  ['XP_TESTS_VIEW', 'ExperimentsRootView'], ['XP_TESTS_LIST_REDIRECT', 'CollectionListRedirect'], ['XP_TEST_EDIT_REDIRECT', 'CollectionEditRedirect'],
] as const
const files = [
  ...admin.map(([, , file]) => `admin/${file}.tsx`), 'admin/copy/tabs.ts',
  'client/ExperimentsProvider.tsx', 'client/useFlagPoint.ts', 'client/useExperiment.ts', 'client/ExperimentPageview.tsx', 'client/trackConversionBeacon.ts',
  'puck/ExperimentSlot.tsx', 'puck/experimentSlotField.ts', 'puck/editor/ExperimentSlotEditor.tsx', 'fields/armSelect.ts',
]
for (const file of files) test(`placeholder: ${file}`, () => {
  const source = readFileSync(fileURLToPath(new URL(`../../src/${file}`, import.meta.url)), 'utf8')
  const lines = source.split('\n')
  const client = file.startsWith('admin/') && file.endsWith('.tsx') || file.startsWith('client/') || file.startsWith('puck/editor/')
  // Once an exp-admin lane replaces a placeholder the marker is gone and only the
  // directive rule applies; ADM-10 asserts that no marker survives at the end.
  const placeholder = source.includes('XP-PLACEHOLDER')
  if (client) {
    expect(lines[0]).toBe("'use client'")
    if (placeholder) expect(lines[1]).toBe('// XP-PLACEHOLDER')
  } else {
    if (placeholder) expect(lines[0]).toBe('// XP-PLACEHOLDER')
    expect(source).not.toContain("'use client'")
  }
})
test('one import-map constant for every admin component', () => {
  expect(Object.keys(paths).sort()).toEqual([...admin, ...views].map(([constant]) => constant).sort())
  for (const [constant, name] of views) expect(paths[constant]).toBe(`@delmaredigital/payload-experiments/rsc#${name}`)
  for (const [constant, name] of admin) expect(paths[constant]).toBe(`@delmaredigital/payload-experiments/admin/client#${name}`)
})
