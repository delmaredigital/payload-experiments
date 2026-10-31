import { expect, test } from 'vitest'
import * as index from '../src/exports/index.js'
import * as runtimeProxy from '../src/exports/runtimeProxy.js'
import * as runtimeServer from '../src/exports/runtimeServer.js'
import * as proxy from '../src/exports/proxy.js'
import * as rsc from '../src/exports/rsc.js'
import * as client from '../src/exports/client.js'
import * as adminClient from '../src/exports/adminClient.js'
import * as puck from '../src/exports/puck.js'
import * as puckEditor from '../src/exports/puckEditor.js'
import { XpNotImplemented } from '../src/errors.js'
import { ROUTES } from '../src/endpoints/index.js'
import { EDITABLE_BY_STATUS, isEditable } from '../src/collections/experiments/editability.js'
import { checkArms, addHoldout } from '../src/collections/experiments/armInvariants.js'
import { lockHook } from '../src/collections/experiments/lockHook.js'
import { flagControlParams } from '../src/collections/experiments/flagControlParams.js'
import { deleteGuard } from '../src/collections/experiments/deleteGuard.js'
import { decideGuard } from '../src/results/decideGuard.js'
import { contentChangesHook } from '../src/hooks/contentChanges.js'

const exportsByEntry = [
  [index, ['createExperimentsPlugin', 'defineFlagPoint', 'defineMetricSource', 'createArmSelectField']],
  [runtimeProxy, ['defineExperimentsProxyRuntime', 'createPostgresManifestLoader', 'createHttpManifestLoader']],
  [runtimeServer, ['defineExperimentsServerRuntime']],
  [proxy, ['resolveExperiments', 'applyExperiments', 'createExperimentProxy']],
  [rsc, ['getAssignments', 'resolveExperimentData', 'recordExposures', 'getFlagPoint', 'linkIdentity', 'trackConversion', 'eraseUser', 'runResults', 'recordContentChange', 'experimentSitemapFilter', 'experimentMetadata', 'toClientAssignments']],
  [client, ['ExperimentsProvider', 'useFlagPoint', 'useExperiment', 'ExperimentPageview', 'trackConversionBeacon', 'MAX_EVENTS_PER_BODY', 'DEFAULT_MAX_BODY_BYTES']],
  [adminClient, ['StatusCell', 'SummaryCell', 'ExperimentActions', 'LockedFieldNotice', 'FlagPointSelect', 'ArmsField', 'AllocationField', 'TargetingAttributeField', 'TargetingOpField', 'TargetingValueField', 'MetricSourceSelect', 'ReviewPanel', 'PhaseHistory', 'LayerUsage', 'ResultsView', 'ArmSelectField']],
  [puck, ['ExperimentSlot', 'createExperimentSlotField', 'EXPERIMENT_SLOT_TYPE']],
  [puckEditor, ['ExperimentSlotEditor']],
] as const

test.each(exportsByEntry)('entry exports every contracted value (%j)', (barrel, names) => {
  expect(Object.keys(barrel).sort()).toEqual([...names].sort())
  for (const [name, value] of Object.entries(barrel)) {
    const expectedType = name.endsWith('_BYTES') || name === 'MAX_EVENTS_PER_BODY' ? 'number'
      : name === 'EXPERIMENT_SLOT_TYPE' ? 'string'
      : name === 'ExperimentSlot' || name === 'ExperimentSlotEditor' ? 'object' : 'function'
    expect(typeof value, name).toBe(expectedType)
  }
})

test('every route resolves a handler', () => {
  expect(ROUTES).toHaveLength(15)
  for (const route of ROUTES) expect(typeof route.handler, route.path).toBe('function')
})

test('editability placeholder has all five statuses and empty typed values', () => {
  expect(EDITABLE_BY_STATUS).toEqual({ draft: [], running: [], stopped: [], decided: [], archived: [] })
})

const stubs: Array<[Function, string]> = [
  [index.createExperimentsPlugin, 'CORE-02c'],
  [runtimeProxy.createPostgresManifestLoader, 'CORE-05'], [runtimeProxy.createHttpManifestLoader, 'CORE-05'],
  ...Object.values(proxy).map(fn => [fn, 'CORE-06'] as [Function, string]),
  ...[rsc.getAssignments, rsc.resolveExperimentData, rsc.toClientAssignments, rsc.getFlagPoint, rsc.experimentMetadata, rsc.experimentSitemapFilter].map(fn => [fn, 'CORE-07'] as [Function, string]),
  ...[rsc.recordExposures, rsc.trackConversion, rsc.linkIdentity, rsc.eraseUser].map(fn => [fn, 'CORE-08a'] as [Function, string]),
  [rsc.recordContentChange, 'CORE-12'], [rsc.runResults, 'CORE-15b'],
  ...[isEditable, lockHook, checkArms, addHoldout, flagControlParams].map(fn => [fn, 'CORE-03'] as [Function, string]),
  [deleteGuard, 'CORE-11'], [decideGuard, 'CORE-13'], [contentChangesHook, 'CORE-12'],
]
for (const [fn, lane] of stubs) {
  test(`${fn.name} throws XpNotImplemented(${lane})`, async () => {
    // Invoke without fabricated request/data: a stub must throw before reading inputs.
    await expect(Promise.resolve().then(() => Reflect.apply(fn, undefined, []))).rejects.toMatchObject({ name: 'XpNotImplemented', lane })
    await expect(Promise.resolve().then(() => Reflect.apply(fn, undefined, []))).rejects.toBeInstanceOf(XpNotImplemented)
  })
}
