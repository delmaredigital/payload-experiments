import { createLocalReq, ValidationError } from 'payload'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createIntegrationHarness } from './harness.js'

// Run with XP_IT_ID_TYPE=serial and uuid. Measured 2026-11-07: tests max 49 ms serial, 37 ms uuid;
// the 60 s caps exceed 3× (beforeAll is harness bootstrap).
let harness: Awaited<ReturnType<typeof createIntegrationHarness>>
const content = (xpGoal: string) => ({ content: [{ type: 'Button', props: { xpGoal } }] })
const request = (manager = true) => createLocalReq({ context: { goalManager: manager } }, harness.payload)
beforeAll(async () => {
  harness = await createIntegrationHarness({
    manage: ({ req }) => req.context.goalManager !== false,
    puckCollections: ['goal-pages'],
    collections: [{ slug: 'goal-pages', versions: { drafts: true },
      access: { create: () => true, read: () => true, update: () => true, delete: () => true, readVersions: () => true, unlock: () => true },
      fields: [{ name: 'title', type: 'text' }, { name: 'puckData', type: 'json' }],
    }],
  })
  await harness.payload.create({ collection: 'xp-metrics', req: await request(),
    data: { name: 'Join', slug: 'join', source: 'click:join', direction: 'increase' } })
}, 60_000)
afterAll(async () => { await harness?.teardown() }, 60_000)

test('a manager publishes Puck content naming a defined click goal', async () => {
  const doc = await harness.payload.create({ collection: 'goal-pages', req: await request(),
    data: { title: 'Defined goal', _status: 'published', puckData: content('join') } })
  expect(doc).toMatchObject({ _status: 'published', puckData: content('join') })
}, 60_000)

test('an undefined goal saves as a draft, manager publish preserves the published row, and an editor can publish the same doc', async () => {
  const { payload } = harness
  const published = await payload.create({ collection: 'goal-pages', req: await request(),
    data: { title: 'Published original', _status: 'published', puckData: content('join') } })
  const draft = await payload.update({ collection: 'goal-pages', id: published.id, req: await request(), draft: true,
    data: { title: 'Unpublished edit', _status: 'draft', puckData: content('undefined-goal') } })
  expect(draft).toMatchObject({ _status: 'draft', puckData: content('undefined-goal') })
  const pending = payload.update({ collection: 'goal-pages', id: published.id, req: await request(), draft: false,
    data: { title: draft.title, _status: 'published', puckData: draft.puckData } })
  await expect(pending).rejects.toBeInstanceOf(ValidationError)
  await expect(pending).rejects.toMatchObject({ data: { collection: 'goal-pages', errors: [{
    path: 'puckData.content.0.props.xpGoal', message: 'No click goal has this name yet. Create it with "+ New click goal".',
  }] } })
  const stored = await payload.findByID({ collection: 'goal-pages', id: published.id, req: await request(), draft: false })
  expect(stored).toEqual(published)
  const latest = await payload.findByID({ collection: 'goal-pages', id: published.id, req: await request(), draft: true })
  expect(latest).toMatchObject({ title: 'Unpublished edit', puckData: content('undefined-goal') })
  const editorPublished = await payload.update({ collection: 'goal-pages', id: published.id, req: await request(false), draft: false,
    data: { title: latest.title, _status: 'published', puckData: latest.puckData } })
  expect(editorPublished).toMatchObject({ id: published.id, _status: 'published', title: 'Unpublished edit', puckData: content('undefined-goal') })
}, 60_000)

test('publishing a stored draft without resending its JSON checks the draft JSON', async () => {
  const { payload } = harness
  const published = await payload.create({ collection: 'goal-pages', req: await request(),
    data: { title: 'Partial publish', _status: 'published', puckData: content('join') } })
  await payload.update({ collection: 'goal-pages', id: published.id, req: await request(), draft: true,
    data: { _status: 'draft', puckData: content('undefined-goal') } })
  // The shape of a REST PATCH { _status: 'published' }: no puckData in the write.
  await expect(payload.update({ collection: 'goal-pages', id: published.id, req: await request(), draft: false,
    data: { _status: 'published' } })).rejects.toMatchObject({ data: { errors: [{ path: 'puckData.content.0.props.xpGoal' }] } })
  expect(await payload.findByID({ collection: 'goal-pages', id: published.id, req: await request(), draft: false })).toEqual(published)
}, 60_000)
