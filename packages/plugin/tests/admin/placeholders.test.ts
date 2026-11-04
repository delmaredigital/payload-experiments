import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import * as paths from '../../src/admin/paths.js'
const admin = [
  ['XP_PLACEMENT_STATUS', 'PlacementStatus', 'PlacementStatus'],
  ['XP_TESTS_NAV_CLIENT', 'TestsNavLink', 'TestsNavLink'],
  ['XP_TESTS_SURFACE', 'TestsSurface', 'surface/TestsSurface'],
  ['XP_TESTS_DASHBOARD_CARDS', 'TestsDashboardCards', 'TestsDashboardCards'],
  ['XP_METRIC_SOURCE_SELECT', 'MetricSourceSelect', 'MetricSourceSelect'],
  ['XP_LAYER_USAGE', 'LayerUsage', 'LayerUsage'],
  ['XP_ARM_SELECT', 'ArmSelectField', 'armSelect/ArmSelectField'],
] as const
const retiredFiles = [
  'admin/StatusCell.tsx',
  'admin/SummaryCell.tsx',
  'admin/actions/ExperimentActions.tsx',
  'admin/LockedFieldNotice.tsx',
  'admin/FlagPointSelect.tsx',
  'admin/arms/ArmsField.tsx',
  'admin/AllocationField.tsx',
  'admin/targeting/TargetingAttributeField.tsx',
  'admin/targeting/TargetingOpField.tsx',
  'admin/targeting/TargetingValueField.tsx',
  'admin/review/ReviewPanel.tsx',
  'admin/PhaseHistory.tsx',
  'admin/results/ResultsView.tsx',
]
const views = [
  ['XP_TESTS_NAV_LINK', 'TestsNavLinkServer'],
  ['XP_TESTS_VIEW', 'ExperimentsRootView'], ['XP_TESTS_LIST_REDIRECT', 'CollectionListRedirect'], ['XP_TEST_EDIT_REDIRECT', 'CollectionEditRedirect'],
] as const
const files = [
  'admin/surface/newTest/NewTest.tsx', 'admin/surface/ResultsRoute.tsx',
  ...admin.map(([, , file]) => `admin/${file}.tsx`),
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
  for (const [constant, name] of views) expect(paths[constant]).toBe(`@delmaredigital/payload-experiments/admin/rsc#${name}`)
  for (const [constant, name] of admin) expect(paths[constant]).toBe(`@delmaredigital/payload-experiments/admin/client#${name}`)
})

test.each(retiredFiles)('%s is retired', file => {
  expect(existsSync(new URL(`../../src/${file}`, import.meta.url))).toBe(false)
})
