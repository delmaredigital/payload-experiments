import { readFileSync } from 'node:fs'
import { expect, expectTypeOf, test, vi } from 'vitest'

// Structural test: it imports every barrel only to check names and routes. The real
// @payloadcms/ui dependency chain reaches CSS that Node's ESM loader rejects, so the
// UI packages are replaced with stub components here (behaviour is tested elsewhere).
vi.mock('@payloadcms/ui', () => new Proxy({}, {
  has: () => true,
  get: (_target, key) => key === '__esModule' ? true : key === 'then' ? undefined : () => null,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }),
  usePathname: () => '/', useSearchParams: () => new URLSearchParams(), useParams: () => ({}),
}))
import ts from 'typescript'
import type { Metadata } from 'next'
import type { Assignments, ExperimentsProxyRuntimeOptions, ExperimentsServerRuntime, Manifest } from '../src/exports/index.js'
import type { ManifestLoader } from '../src/runtime/loaders.js'
import type { ExperimentsProxyResult } from '../src/proxy/resolve.js'
import type { ArmIssue } from '../src/collections/experiments/armInvariants.js'
import * as index from '../src/exports/index.js'
import * as runtimeProxy from '../src/exports/runtimeProxy.js'
import * as runtimeServer from '../src/exports/runtimeServer.js'
import * as proxy from '../src/exports/proxy.js'
import * as rsc from '../src/exports/rsc.js'
import * as client from '../src/exports/client.js'
import * as adminClient from '../src/exports/adminClient.js'
import * as adminRsc from '../src/exports/adminRsc.js'
import * as puck from '../src/exports/puck.js'
import * as puckEditor from '../src/exports/puckEditor.js'
import { XpNotImplemented } from '../src/errors.js'
import { ROUTES } from '../src/endpoints/index.js'
import { EDITABLE_BY_STATUS, isEditable } from '../src/collections/experiments/editability.js'
import { checkArms, addHoldout } from '../src/collections/experiments/armInvariants.js'
import { lockHook } from '../src/collections/experiments/lockHook.js'
import { flagControlParams } from '../src/collections/experiments/flagControlParams.js'
import { deleteGuard, deleteGuardAfter } from '../src/collections/experiments/deleteGuard.js'
import { decideGuard } from '../src/results/decideGuard.js'
import { contentChangesHook } from '../src/hooks/contentChanges.js'

const exportsByEntry = [
  [index, ['createExperimentsPlugin', 'defineFlagPoint', 'defineMetricSource', 'createArmSelectField']],
  [runtimeProxy, ['defineExperimentsProxyRuntime', 'createPostgresManifestLoader', 'createHttpManifestLoader']],
  [runtimeServer, ['defineExperimentsServerRuntime']],
  [proxy, ['resolveExperiments', 'applyExperiments', 'createExperimentProxy']],
  [rsc, ['getAssignments', 'resolveExperimentData', 'recordExposures', 'getFlagPoint', 'linkIdentity', 'trackConversion', 'eraseUser', 'runResults', 'recordContentChange', 'captureContentBaseline', 'experimentSitemapFilter', 'experimentMetadata', 'toClientAssignments', 'compileManifest']],
  [client, ['ExperimentsProvider', 'useFlagPoint', 'useExperiment', 'ExperimentPageview', 'trackConversionBeacon', 'MAX_EVENTS_PER_BODY', 'DEFAULT_MAX_BODY_BYTES']],
  [adminClient, ['XP_IF_UPDATED_AT_HEADER', 'TestsDashboardCards', 'TestsNavLink', 'TestsSurface', 'MetricSourceSelect', 'LayerUsage', 'ArmSelectField']],
  [adminRsc, ['ExperimentsRootView', 'CollectionListRedirect', 'CollectionEditRedirect']],
  [puck, ['ExperimentSlot', 'createExperimentSlotField', 'EXPERIMENT_SLOT_TYPE']],
  [puckEditor, ['ExperimentSlotEditor', 'deriveAccent']],
] as const

test('root barrel keeps public types and excludes internal contracts and the Puck Slot peer type', () => {
  const filename = new URL('../src/exports/index.ts', import.meta.url)
  const source = ts.createSourceFile(filename.pathname, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true)
  const names = source.statements.flatMap(statement => ts.isExportDeclaration(statement) && statement.isTypeOnly && statement.exportClause && ts.isNamedExports(statement.exportClause)
    ? statement.exportClause.elements.map(element => element.name.text) : [])
  expect(names).toEqual(expect.arrayContaining(['ReadinessCode', 'ExperimentsPluginOptions', 'MetricSource', 'FlagPoint', 'ParamField', 'Attributes', 'ExperimentsProxyRuntimeOptions', 'ExperimentsProxyRuntime', 'ExperimentsServerRuntimeOptions', 'ExperimentsServerRuntime', 'Manifest', 'Assignments', 'ClientAssignments', 'Snapshot', 'ResultsResponse', 'DocId']))
  for (const name of ['ResolvedOptions', 'EndpointContext', 'AccessKind', 'Slot']) expect(names).not.toContain(name)
})

test('approved signature refinements remain available through the public types and barrels', () => {
  expectTypeOf<Assignments['archivedWinners']>().toEqualTypeOf<Record<string, string>>()
  expectTypeOf<ManifestLoader>().toEqualTypeOf<NonNullable<ExperimentsProxyRuntimeOptions['loadManifest']>>()
  expectTypeOf<Parameters<ManifestLoader>>().toEqualTypeOf<[opts?: { ifRevision?: number }]>()
  expectTypeOf<ReturnType<ManifestLoader>>().toEqualTypeOf<Promise<Manifest | 'not-modified' | null>>()
  expectTypeOf<Parameters<typeof rsc.experimentMetadata>>().toEqualTypeOf<[ExperimentsServerRuntime, string]>()
  expectTypeOf<ReturnType<typeof rsc.experimentMetadata>>().toEqualTypeOf<Promise<Pick<Metadata, 'robots' | 'alternates'>>>()
  expectTypeOf<ExperimentsProxyResult['responseHeaders']>().toEqualTypeOf<Headers | undefined>()
  expectTypeOf<ArmIssue>().toEqualTypeOf<{ code: import('../src/types/endpoints.js').ArmIssueCode; armIndex?: number; armKey?: string; message: string }>()
})

test.each(exportsByEntry)('entry exports every contracted value (%j)', (barrel, names) => {
  expect(Object.keys(barrel).sort()).toEqual([...names].sort())
  for (const [name, value] of Object.entries(barrel)) {
    const expectedType = name.endsWith('_BYTES') || name === 'MAX_EVENTS_PER_BODY' ? 'number'
      : name === 'EXPERIMENT_SLOT_TYPE' || name === 'XP_IF_UPDATED_AT_HEADER' ? 'string'
      : name === 'ExperimentSlot' || name === 'ExperimentSlotEditor' ? 'object' : 'function'
    expect(typeof value, name).toBe(expectedType)
  }
})

test('every route resolves a handler', () => {
  expect(ROUTES).toHaveLength(17)
  for (const route of ROUTES) expect(typeof route.handler, route.path).toBe('function')
})

test('editability table has exactly the five statuses', () => {
  expect(Object.keys(EDITABLE_BY_STATUS).sort()).toEqual(['archived', 'decided', 'draft', 'running', 'stopped'])
  for (const fields of Object.values(EDITABLE_BY_STATUS)) expect(Array.isArray(fields)).toBe(true)
})

const stubs: Array<[Function, string]> = [
  [runtimeProxy.createPostgresManifestLoader, 'CORE-05'], [runtimeProxy.createHttpManifestLoader, 'CORE-05'],
  ...Object.values(proxy).map(fn => [fn, 'CORE-06'] as [Function, string]),
  ...[rsc.getAssignments, rsc.resolveExperimentData, rsc.toClientAssignments, rsc.getFlagPoint, rsc.experimentMetadata, rsc.experimentSitemapFilter].map(fn => [fn, 'CORE-07'] as [Function, string]),
  ...[rsc.recordExposures, rsc.trackConversion, rsc.linkIdentity, rsc.eraseUser].map(fn => [fn, 'CORE-08a'] as [Function, string]),
  [rsc.runResults, 'CORE-15b'],
  ...[isEditable, lockHook, checkArms, addHoldout, flagControlParams].map(fn => [fn, 'CORE-03'] as [Function, string]),
  [deleteGuard, 'CORE-11'], [deleteGuardAfter, 'CORE-11'], [decideGuard, 'CORE-13'],
]
for (const [fn, lane] of stubs) {
  test(`${fn.name} is a stub of ${lane} or has been implemented`, async () => {
    // Invoke without fabricated request/data: a stub throws before reading inputs.
    // Once the owning lane lands, the body no longer throws XpNotImplemented and the
    // entry passes; while it is still a stub, the lane label must be right.
    const outcome = await Promise.resolve().then(() => Reflect.apply(fn, undefined, [])).then(() => null, (error: unknown) => error)
    if (outcome instanceof XpNotImplemented) expect(outcome).toMatchObject({ name: 'XpNotImplemented', lane })
  })
}

test('hooks installed on host collections pass the document through and never throw', async () => {
  const doc = { id: 1, puckData: { content: [] } }
  await expect(Promise.resolve().then(() => Reflect.apply(contentChangesHook, undefined, [{ doc, previousDoc: doc, req: { payload: { config: {} } }, collection: { slug: 'pages' } }]))).resolves.toBe(doc)
})
