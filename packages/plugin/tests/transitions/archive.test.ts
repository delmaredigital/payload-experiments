import { expect, test, vi } from 'vitest'
import { fakePayload } from '../_fakes/payload.js'
import { createFakeExecutor } from '../_fakes/executor.js'
import { sampleOptions } from '../collections/fixtures.js'
import type { Arm } from '../../src/types/contracts.js'

function fixture(status = 'running', holdout = true, layer = false) {
  const options = sampleOptions()
  const executor = createFakeExecutor()
  const arms: Arm[] = [
    { key: 'control', label: 'Original', kind: 'control', weight: holdout ? 5 : 50, slot: 'control', pageTarget: '/original' },
    { key: 'variantA', label: '  Better title  ', kind: 'variant', weight: holdout ? 93 : 50, slot: 'variantA', pageTarget: '/winner' },
    ...(holdout ? [{ key: 'holdout', label: 'Holdout', kind: 'holdout', weight: 2 } as Arm] : []),
  ]
  const slices = Array.from({ length: 50 }, (_, i) => i)
  const payload = fakePayload({ executor, config: { custom: { xp: options } },
    overrides: { findGlobal: vi.fn(async () => ({ flagDefaults: {} })) },
    collections: {
      'xp-experiments': [{ id: 1, slug: 'hero', kind: 'code', status, unitType: 'visitor', arms, allocation: 50,
        phase: 1, seed: 'test|', layerSlices: layer && status === 'running' ? slices : [], ...(layer ? { layer: 3 } : {}),
        targeting: [{ attribute: 'country', op: 'eq', value: 'CHANGED' }], exposurePolicy: 'manual' }],
      'xp-phases': [{ id: 9, experiment: 1, phase: 1, phaseKind: 'test', seed: 'test|', arms, allocation: 50,
        startedAt: '2026-10-01T00:00:00.000Z', ...(status === 'stopped' ? { endedAt: '2026-10-20T00:00:00.000Z' } : {}),
        targeting: [{ attribute: 'country', op: 'eq', value: 'US', type: 'string' }],
        metricDefinitions: [{ metricId: 2, role: 'primary' }], analysis: { layerSlices: layer ? slices : [] } }],
      'xp-results-snapshots': [{ id: 7, experiment: 1, phase: 1, computedAt: '2026-10-21T00:00:00.000Z', snapshot: { verdict: { row: 7, code: 'winner', recommendedArm: 'variantA' } } }],
    },
  })
  let revision = 8
  const manifests: any[] = []
  executor.query = async <R>(text: string, params: unknown[] = []) => {
    executor.calls.push({ text, params })
    let rows: unknown[] = []
    if (text.includes(' AS slices ')) rows = payload.documents['xp-experiments']!.filter(doc => doc.layer === params[0] && ['running', 'decided'].includes(String(doc.status))).map(doc => ({ slices: doc.layerSlices }))
    if (text.includes('RETURNING "revision"')) rows = [{ revision: ++revision }]
    if (text.includes('"manifest" =')) manifests.push(JSON.parse(params[0] as string))
    return { rows: rows as R[], rowCount: 1 }
  }
  const find = payload.find.bind(payload)
  vi.spyOn(payload, 'find').mockImplementation(async args => {
    // The fake does not sort. Model Payload's newest-round/snapshot query here.
    const result = await find({ ...args, limit: 0 })
    if (args.sort) result.docs.sort((a, b) => args.collection === 'xp-phases' ? Number(b.phase) - Number(a.phase) : String(b.computedAt).localeCompare(String(a.computedAt)))
    if (args.limit) result.docs = result.docs.slice(0, args.limit)
    if (args.depth === 1) for (const doc of result.docs) if (doc.layer === 3) doc.layer = { id: 3, slug: 'home' }
    return result
  })
  const req = executor.withSession({ payload })
  req.user = { id: 42 } as typeof req.user
  const experiment = payload.documents['xp-experiments']![0]!
  const phase = payload.documents['xp-phases']![0]!
  return { req, payload, executor, experiment, phase, manifests, slices }
}
import { decide } from '../../src/transitions/decide.js'
import { archive } from '../../src/transitions/archive.js'
import type { ArchiveBody } from '../../src/types/endpoints.js'

for (const mode of ['stopped', 'after-content', 'discard', 'hard-coded'] as const) {
  test.each(['draft', 'running', 'stopped', 'decided', 'archived'])(`${mode} × %s`, async status => {
    const f = fixture(status, false)
    f.experiment.decision = { winnerArm: 'variantA', note: 'Keep audit', contentReport: { docs: [{ ok: true }] } }
    const confirmation = mode === 'discard' ? 'discard winner' : 'the developer has hard-coded Better title'
    const action = archive(f.req, { experimentId: 1, mode, confirmation })
    if (status === (mode === 'stopped' ? 'stopped' : 'decided')) {
      const result = await action
      expect(result).toMatchObject({ revision: 9, doc: { status: 'archived', layerSlices: [] } })
      expect(f.phase.endedAt).toBeTruthy()
      if (mode === 'discard') expect(f.experiment.decision).toMatchObject({ winnerArm: null, note: 'Keep audit', discardedAt: expect.any(String) })
    } else await expect(action).rejects.toMatchObject({ code: 'invalid-status' })
  })
}
test.each(['block', 'page', 'flag'])('hard-coded refuses kind %s', async kind => {
  const f = fixture('decided')
  f.experiment.kind = kind
  await expect(archive(f.req, { experimentId: 1, mode: 'hard-coded', confirmation: 'the developer has hard-coded Better title' })).rejects.toMatchObject({ code: 'invalid-status' })
})
test.each([undefined, null, {}, [], { docs: [] }, { docs: [{ ok: false }] }, { docs: [{ ok: true }, { ok: false }] }])('after-content requires a nonempty, completed report %j', async contentReport => {
  const f = fixture('decided')
  f.experiment.decision = { winnerArm: 'variantA', contentReport }
  await expect(archive(f.req, { experimentId: 1, mode: 'after-content' })).rejects.toMatchObject({ code: 'invalid-status' })
})
test.each(['discard', 'hard-coded'] as const)('%s requires exact typed phrase', async mode => {
  const f = fixture('decided')
  f.experiment.decision = { winnerArm: 'variantA' }
  await expect(archive(f.req, { experimentId: 1, mode, confirmation: mode === 'discard' ? 'Discard winner' : 'the developer has hard-coded variantA' })).rejects.toMatchObject({ code: 'confirmation-required' })
})
test.each(['block', 'page'])('archive %s preserves winner routing, discard removes it', async kind => {
  for (const discard of [false, true]) {
    const f = fixture('running', true, true)
    f.experiment.kind = kind
    await decide(f.req, { experimentId: 1, winnerArm: 'variantA' })
    f.experiment.decision = { ...f.experiment.decision as any, contentReport: { docs: [{ ok: true }] } }
    await archive(f.req, { experimentId: 1, mode: discard ? 'discard' : 'after-content', confirmation: ' discard winner ' })
    expect(f.experiment.layerSlices).toEqual([])
    const manifest = f.manifests[1]
    expect(manifest.experiments).toEqual([])
    if (kind === 'block') expect(manifest.archivedWinners).toEqual(discard ? {} : { hero: 'variantA' })
    else expect(manifest.archivedPages).toEqual(discard ? {} : { '/original': { slug: 'hero', winnerPath: '/winner' } })
  }
})


test.each([false, true])('after-content accepts ok and dismissed failures (legacy array=%s) and preserves the audit', async legacy => {
  const f = fixture('decided')
  const docs = [{ ok: true }, { ok: false, dismissedAt: '2026-11-03T10:00:00.000Z', dismissedBy: '42' }]
  const decision = { winnerArm: 'variantA', note: 'Kept winner', contentReport: legacy ? docs : { docs } }
  f.experiment.decision = decision
  expect((await archive(f.req, { experimentId: 1, mode: 'after-content' })).doc.status).toBe('archived')
  expect(f.experiment.decision).toEqual(decision)
})
