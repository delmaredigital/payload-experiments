import type { PayloadRequest } from 'payload'
import { describe, expect, test, vi } from 'vitest'
import { buildAndStoreManifest, compileManifest, loadManifestInputs, type ManifestInputExperiment, type ManifestInputs, type ManifestPhase } from '../../src/manifest/compile.js'
import { createFakeExecutor } from '../_fakes/executor.js'

function phase(overrides: Partial<ManifestPhase> = {}): ManifestPhase {
  return { phase: 2, phaseKind: 'test', seed: 'frozen|', allocation: 40, targeting: [], arms: [
    { key: 'control', label: 'Original', kind: 'control', weight: 50, slot: 'control', pageTarget: '/original' },
    { key: 'variantA', label: 'A', kind: 'variant', weight: 30, slot: 'variantA', pageTarget: '/a', params: { title: 'Frozen' } },
    { key: 'variantB', label: 'B', kind: 'variant', weight: 10, slot: 'variantB', pageTarget: '/b' },
    { key: 'holdout', label: 'Holdout', kind: 'holdout', weight: 10 },
  ], ...overrides }
}
function experiment(overrides: Partial<ManifestInputExperiment> = {}): ManifestInputExperiment {
  return { id: 1, slug: 'hero', kind: 'block', unitType: 'visitor', status: 'running', exposurePolicy: 'render', arms: phase().arms, currentPhase: phase(), ...overrides }
}
function inputs(experiments: ManifestInputExperiment[], rest: Partial<ManifestInputs> = {}): ManifestInputs { return { experiments, flagDefaults: {}, ...rest } }

describe('pure manifest compiler', () => {
  test('includes only running/decided and uses immutable phase config over edited live fields', () => {
    const e = { ...experiment(), allocation: 99, seed: 'edited', phase: 99, targeting: [{ attribute: 'staff', op: 'eq', value: true }], arms: [] }
    const manifest = compileManifest(inputs([e, experiment({ id: 2, status: 'draft' }), experiment({ id: 3, status: 'stopped' }), experiment({ id: 4, status: 'decided', decision: { winnerArm: 'variantA' } })]), 7)
    expect(manifest.revision).toBe(7)
    expect(manifest.experiments.map(e => e.id)).toEqual([1, 4])
    expect(manifest.experiments[0]).toMatchObject({ phase: 2, phaseKind: 'test', seed: 'frozen|', coverage: 0.4, targeting: [], deferrable: false })
    expect(manifest.experiments[0]!.arms).toEqual(phase().arms.map(({ label: _label, ...arm }) => arm))
  })
  test('layer slices provide allocation and force coverage 1', () => {
    const layered = experiment({ layer: { slug: 'marketing' }, layerSlices: [2, 4, 9] })
    expect(compileManifest(inputs([layered]), 1).experiments[0]).toMatchObject({ coverage: 1, layer: { slug: 'marketing', slices: [2, 4, 9] } })
  })
  test.each([
    { layer: 7, layerSlices: [2] },
    { layer: { slug: 'marketing' } },
    { layer: { slug: 'marketing' }, layerSlices: null },
    { layer: { slug: '' }, layerSlices: [2] },
  ])('refuses incomplete active layer state (%j)', configuration => {
    for (const status of ['running', 'decided'] as const) {
      const e = experiment({ ...configuration, status, currentPhase: phase({ phaseKind: status === 'decided' ? 'rollout' : 'test' }) })
      expect(() => compileManifest(inputs([e]), 1)).toThrow(expect.objectContaining({ code: 'invalid-status', status: 409 }))
    }
  })
  test('rollout carries winner and holdout; decided without rollout drops layer and holdoutKey', () => {
    const common = { status: 'decided' as const, layer: { slug: 'layer' }, layerSlices: [2], decision: { winnerArm: 'variantA' } }
    const result = compileManifest(inputs([
      experiment({ ...common, currentPhase: phase({ phaseKind: 'rollout' }) }),
      experiment({ ...common, id: 2 }),
      experiment({ ...common, id: 3, currentPhase: phase({ phaseKind: 'rollout', endedAt: '2026-10-30Z' }) }),
    ]), 3).experiments
    expect(result[0]).toMatchObject({ phaseKind: 'rollout', holdoutKey: 'holdout', winnerArm: 'variantA', coverage: 1 })
    for (const e of result.slice(1)) {
      expect(e).toMatchObject({ phaseKind: 'test', winnerArm: 'variantA', coverage: 1 })
      expect(e).not.toHaveProperty('layer')
      expect(e).not.toHaveProperty('holdoutKey')
    }
  })
  test.each(['loggedIn', 'staff', 'country'])('deferrable for %s', attribute => {
    const e = experiment({ currentPhase: phase({ targeting: [{ attribute, op: 'eq', value: true }] }) })
    expect(compileManifest(inputs([e]), 1).experiments[0]!.deferrable).toBe(attribute !== 'country')
  })
  test('archives block winners and every losing page target, omitting discarded decisions', () => {
    const result = compileManifest(inputs([
      experiment({ status: 'archived', arms: [], decision: { winnerArm: 'variantA' } }),
      experiment({ id: 2, slug: 'page', kind: 'page', status: 'archived', arms: phase().arms.map(arm => ({ ...arm, pageTarget: '/edited' })), decision: { winnerArm: 'variantA' } }),
      experiment({ id: 3, slug: 'discarded', status: 'archived', decision: { winnerArm: 'variantA', discardedAt: '2026-10-30Z' } }),
      experiment({ id: 4, slug: 'discarded-page', kind: 'page', status: 'archived', decision: { winnerArm: 'variantB', discardedAt: '2026-10-30Z' } }),
    ]), 1)
    expect(result.experiments).toEqual([])
    expect(result.archivedWinners).toEqual({ hero: 'variantA' })
    expect(result.archivedPages).toEqual({ '/original': { slug: 'page', winnerPath: '/a' }, '/b': { slug: 'page', winnerPath: '/a' } })
  })
  test('excludes IDs everywhere, copies defaults and does not retain input references', () => {
    const source = inputs([experiment(), experiment({ id: 2, slug: 'archived', status: 'archived', decision: { winnerArm: 'variantA' } }), experiment({ id: 3, kind: 'page', status: 'archived', decision: { winnerArm: 'variantA' } })], {
      excludeIds: ['1', 2, 3], flagDefaults: {
        excluded: { experiment: 1, winnerArm: 'variantA', params: {}, decidedAt: 'now' },
        kept: { experiment: 4, winnerArm: 'variantA', params: { n: '123' }, decidedAt: 'now' },
      },
    })
    const before = structuredClone(source)
    const result = compileManifest(source, 1)
    expect(result).toMatchObject({ experiments: [], archivedWinners: {}, archivedPages: {}, flagDefaults: { kept: before.flagDefaults.kept } })
    expect(result.flagDefaults).not.toHaveProperty('excluded')
    result.flagDefaults.kept!.params.n = 'changed'
    expect(source).toEqual(before)
  })
  test('refuses to publish live experiments with no phase', () => {
    expect(() => compileManifest(inputs([experiment({ currentPhase: null })]), 1)).toThrow('Missing current phase')
  })
  test('refuses an archived winner with no last phase rather than using live arms', () => {
    expect(() => compileManifest(inputs([experiment({ status: 'archived', currentPhase: null, decision: { winnerArm: 'variantA' } })]), 1))
      .toThrow(expect.objectContaining({ code: 'invalid-status', status: 409 }))
  })
})

test('loader reads current highest phase with req, privileged access, depth 1 layer and exclusions', async () => {
  const find = vi.fn(async (args: { collection: string }) => ({ docs: args.collection === 'xp-experiments' ? [experiment(), experiment({ id: 2 })] : [phase()] }))
  const findGlobal = vi.fn(async () => ({ flagDefaults: {} }))
  const req = { payload: { find, findGlobal } } as unknown as PayloadRequest
  const loaded = await loadManifestInputs(req, { excludeIds: [2] })
  expect(loaded.experiments).toHaveLength(1)
  expect(loaded.experiments[0]!.currentPhase).toEqual(phase())
  expect(find).toHaveBeenNthCalledWith(1, expect.objectContaining({ collection: 'xp-experiments', depth: 1, limit: 0, req, overrideAccess: true }))
  expect(find).toHaveBeenNthCalledWith(2, expect.objectContaining({ collection: 'xp-phases', limit: 1, sort: '-phase', req, overrideAccess: true, where: { experiment: { equals: 1 } } }))
  expect(findGlobal).toHaveBeenCalledWith(expect.objectContaining({ slug: 'xp-state', req, overrideAccess: true }))
})

test('builder bumps before the first experiment read and stores the new revision on its transaction', async () => {
  const executor = createFakeExecutor({ results: [{ rows: [] }, { rows: [{ revision: 8 }] }, { rows: [] }] })
  const req = executor.withSession()
  req.payload.find = vi.fn(async () => {
    expect(executor.calls).toHaveLength(2)
    expect(executor.calls[0]!.text).toContain('pg_advisory_xact_lock')
    expect(executor.calls[1]!.text).toContain('RETURNING')
    return { docs: [] }
  }) as unknown as typeof req.payload.find
  req.payload.findGlobal = vi.fn(async () => ({ flagDefaults: {} })) as unknown as typeof req.payload.findGlobal
  const result = await buildAndStoreManifest(req)
  expect(result.revision).toBe(8)
  expect(executor.calls).toHaveLength(3)
  expect(executor.calls[0]!.text).toContain('pg_advisory_xact_lock')
  expect(executor.calls[1]!.text).toContain('RETURNING')
  expect(JSON.parse(executor.calls[2]!.params[0] as string)).toEqual(result)
})
