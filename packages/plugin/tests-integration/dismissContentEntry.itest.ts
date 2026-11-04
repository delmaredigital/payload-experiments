import { createLocalReq } from 'payload'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createIntegrationHarness } from './harness.js'
import { start } from '../src/transitions/start.js'
import { stop } from '../src/transitions/stop.js'
import { decide } from '../src/transitions/decide.js'
import { makeContent } from '../src/transitions/makeContent.js'
import { dismissContentEntry } from '../src/transitions/dismissContentEntry.js'
import { restoreContentEntry } from '../src/transitions/restoreContentEntry.js'
import { archive } from '../src/transitions/archive.js'
import type { ResolvedOptions } from '../src/types/contracts.js'

// Train-only: exp-core runs this against both serial and uuid Postgres adapters.
let harness: Awaited<ReturnType<typeof createIntegrationHarness>>
beforeAll(async () => {
  harness = await createIntegrationHarness({
    collections: [{ slug: 'dismiss-pages',
      access: { create: () => true, read: () => true, update: ({ req }) => req.context.denyPage !== true,
        delete: () => true, readVersions: () => true, unlock: () => true },
      fields: [{ name: 'content', type: 'json' }],
    }], puckCollections: [{ slug: 'dismiss-pages', field: 'content' }],
  })
}, 60_000)
afterAll(async () => { await harness?.teardown() })

async function failedContent(name: string) {
  const { payload } = harness
  const req = await createLocalReq({}, payload)
  const options = payload.config.custom!.xp as ResolvedOptions
  const metric = await payload.create({ collection: 'xp-metrics', req, overrideAccess: true,
    data: { name: 'Dismiss goal', slug: name + '-goal', source: 'binomial', direction: 'increase' } })
  const experiment = await payload.create({ collection: 'xp-experiments', req, overrideAccess: true, data: {
    name: 'Dismiss', slug: name, kind: 'block', unitType: 'visitor', allocation: 100, exposurePolicy: 'render',
    arms: [{ key: 'control', label: 'Original', kind: 'control', weight: 50, slot: 'control' },
      { key: 'variantA', label: 'Variant A', kind: 'variant', weight: 50, slot: 'variantA' }],
    metrics: { primary: metric.id }, analysis: { plannedDurationDays: 14, reachPerDay: 100 },
  } })
  const content = { content: [{ type: 'ExperimentSlot', props: {
    id: 'slot', experiment: { id: String(experiment.id), slug: name },
    control: [{ type: 'Text', props: { text: 'Original' } }], variantA: [{ type: 'Text', props: { text: 'Winner' } }],
  } }] }
  const page = await payload.create({ collection: 'dismiss-pages', req, overrideAccess: false, data: { content } })
  await start(req, { experimentId: experiment.id, options })
  await stop(req, { experimentId: experiment.id })
  await decide(req, { experimentId: experiment.id, winnerArm: 'variantA', note: 'Keep result', confirmation: 'Variant A' })
  req.context.denyPage = true
  const made = await makeContent(req, { experimentId: experiment.id, options })
  expect(made.doc.status).toBe('decided')
  expect(made.docs).toMatchObject([{ collection: 'dismiss-pages', id: page.id, ok: false, detail: 'forbidden' }])
  return { req, options, experiment, page, content }
}

test('decide, make-content with a forbidden page, dismiss, then archive keeping the winner', async () => {
  const { payload } = harness
  const { req, experiment, page, content } = await failedContent('dismiss-entry')
  await expect(archive(req, { experimentId: experiment.id, mode: 'after-content' })).rejects.toMatchObject({ code: 'invalid-status' })
  const stateBefore = await payload.findGlobal({ slug: 'xp-state', req, overrideAccess: true })
  await dismissContentEntry(req, { experimentId: experiment.id, collection: 'dismiss-pages', id: String(page.id) })
  const stateAfter = await payload.findGlobal({ slug: 'xp-state', req, overrideAccess: true })
  expect(stateAfter.revision).toBe(stateBefore.revision)
  const result = await archive(req, { experimentId: experiment.id, mode: 'after-content' })
  expect(result.doc).toMatchObject({ status: 'archived', decision: { winnerArm: 'variantA', note: 'Keep result', contentReport: {
    docs: [{ collection: 'dismiss-pages', id: page.id, ok: false, dismissedAt: expect.any(String), dismissedBy: null }],
  } } })
  expect((await payload.findByID({ collection: 'dismiss-pages', id: page.id, req, overrideAccess: false })).content).toEqual(content)
})

test('dismiss, restore, then retry updates the page and clears dismissal fields', async () => {
  const { payload } = harness
  const { req, options, experiment, page } = await failedContent('restore-entry')
  const stateBefore = await payload.findGlobal({ slug: 'xp-state', req, overrideAccess: true })
  await dismissContentEntry(req, { experimentId: experiment.id, collection: 'dismiss-pages', id: page.id })
  const restored = await restoreContentEntry(req, { experimentId: experiment.id, collection: 'dismiss-pages', id: String(page.id) })
  expect(restored.doc.decision).toMatchObject({ winnerArm: 'variantA', contentReport: {
    docs: [{ collection: 'dismiss-pages', id: page.id, ok: false, detail: 'forbidden' }],
  } })
  const entry = (restored.doc.decision as any).contentReport.docs[0]
  expect(entry).not.toHaveProperty('dismissedAt')
  expect(entry).not.toHaveProperty('dismissedBy')
  const stateAfter = await payload.findGlobal({ slug: 'xp-state', req, overrideAccess: true })
  expect(stateAfter.revision).toBe(stateBefore.revision)
  req.context.denyPage = false
  const result = await makeContent(req, { experimentId: experiment.id, options })
  expect(result.doc.status).toBe('archived')
  expect(result.docs).toEqual([{ collection: 'dismiss-pages', id: page.id, ok: true }])
  expect((await payload.findByID({ collection: 'dismiss-pages', id: page.id, req, overrideAccess: false })).content)
    .toEqual({ content: [{ type: 'Text', props: { text: 'Winner' } }] })
})
