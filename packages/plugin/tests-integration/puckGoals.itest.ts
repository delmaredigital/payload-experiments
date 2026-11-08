import { REST_PATCH } from '@payloadcms/next/routes'
import { createLocalReq, getPayload, ValidationError } from 'payload'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { xpGoalField } from '../src/fields/xpGoal.js'
import { CLICK_GOAL_COPY, puckGoalRefusal } from '../src/goals/picker/copy.js'
import { createIntegrationHarness } from './harness.js'

// Run with XP_IT_ID_TYPE=serial and uuid. Measured by the workstream 2026-11-07 (CORE-L5d),
// both modes: max 62 ms serial, 54 ms uuid; REST cases 15-19 ms.
// Each is far below 1/3 of its explicit 60 s cap. beforeAll is harness bootstrap.
let harness: Awaited<ReturnType<typeof createIntegrationHarness>>
let restoreCache: (() => void) | undefined
const content = (xpGoal: string) => ({ content: [{ type: 'Button', props: { xpGoal } }] })
const request = (manager = true) => createLocalReq({ context: { goalManager: manager } }, harness.payload)
beforeAll(async () => {
  harness = await createIntegrationHarness({
    manage: ({ req }) => req.context.goalManager !== false,
    puckCollections: ['goal-pages'],
    collections: [{ slug: 'goal-pages', versions: { drafts: true },
      access: { create: () => true, read: () => true, update: () => true, delete: () => true, readVersions: () => true, unlock: () => true },
      fields: [{ name: 'title', type: 'text' }, { name: 'puckData', type: 'json' },
        { name: 'layout', type: 'blocks', blocks: [{ slug: 'button', fields: [xpGoalField()] }] }],
    }],
  })
  // Use the harness instance in the real Next REST handler, without booting a second adapter.
  const cache = (globalThis as typeof globalThis & {
    _payload: Map<string, { payload: typeof harness.payload; initializedCrons: boolean; promise: null; reload: boolean; ws: null }>
  })._payload
  const previous = cache.get('default')
  cache.set('default', { payload: harness.payload, initializedCrons: true, promise: null, reload: false, ws: null })
  restoreCache = () => { if (previous) cache.set('default', previous); else cache.delete('default') }
  expect(await getPayload({ config: harness.payload.config })).toBe(harness.payload)
  await harness.payload.create({ collection: 'xp-metrics', req: await request(),
    data: { name: 'Join', slug: 'join', source: 'click:join', direction: 'increase' } })
}, 60_000)
afterAll(async () => { restoreCache?.(); await harness?.teardown() }, 60_000)

async function patch(id: string | number, data: Record<string, unknown>) {
  return REST_PATCH(harness.payload.config)(new Request(`http://localhost/api/goal-pages/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  }), { params: Promise.resolve({ slug: ['goal-pages', String(id)] }) })
}

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
  await expect(pending).rejects.toMatchObject({ name: 'ValidationError', status: 400,
    message: puckGoalRefusal('undefined-goal', 'Button', false), data: { collection: 'goal-pages', errors: [{
    path: 'puckData.content.0.props.xpGoal', message: CLICK_GOAL_COPY.undefinedKey,
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
  const response = await patch(published.id, { _status: 'published' })
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ errors: [{ name: 'ValidationError',
    message: puckGoalRefusal('undefined-goal', 'Button', false),
    data: { errors: [{ path: 'puckData.content.0.props.xpGoal', message: CLICK_GOAL_COPY.undefinedKey }] },
  }] })
  expect(await payload.findByID({ collection: 'goal-pages', id: published.id, req: await request(), draft: false })).toEqual(published)
}, 60_000)

test.each(['undefined-goal', 'BAD'])('real Payload REST publish refusal preserves sentence and field data for %s', async key => {
  const doc = await harness.payload.create({ collection: 'goal-pages', req: await request(),
    data: { title: 'REST publish', _status: 'published', puckData: content('join') } })
  const response = await patch(doc.id, { _status: 'published', puckData: content(key) })
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ errors: [{ name: 'ValidationError',
    message: puckGoalRefusal(key, 'Button', key === 'BAD'),
    data: { collection: 'goal-pages', errors: [{ path: 'puckData.content.0.props.xpGoal',
      message: key === 'BAD' ? CLICK_GOAL_COPY.invalidKey : CLICK_GOAL_COPY.undefinedKey }] },
  }] })
}, 60_000)

test('Payload blocks admin REST PATCH retains the existing field-level path and copy', async () => {
  const doc = await harness.payload.create({ collection: 'goal-pages', req: await request(),
    data: { title: 'Admin blocks', _status: 'published', puckData: content('join') } })
  const response = await patch(doc.id, { _status: 'published', layout: [{ blockType: 'button', xpGoal: 'undefined-goal' }] })
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ errors: [{ data: { errors: [{
    path: 'layout.0.xpGoal', message: CLICK_GOAL_COPY.undefinedKey,
  }] } }] })
}, 60_000)
