import { expect, test, vi } from 'vitest'
import { asymmetricGoal, goalContent } from '../../src/goals/fairness.js'
import { checkStart } from '../../src/transitions/checkStart.js'
import { defaultArms } from '../../src/collections/experiments/armInvariants.js'
import { handleClickKeys } from '../../src/endpoints/clickKeys.js'
import { sanitizeReadinessDetail } from '../../src/sanitizeReadinessDetail.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { sampleOptions } from '../collections/fixtures.js'
const arms = defaultArms('block')
const experiment = { id: 1, slug: 'fair', name: 'Fair', kind: 'block' as const, status: 'draft' as const, unitType: 'user' as const, arms, allocation: 100, exposurePolicy: 'render' as const, metrics: { primary: 2 }, analysis: { plannedDurationDays: 14 } }

test('click primary is allowed for both unit types; primary/guardrail asymmetry refuses, secondary only warns', () => {
  const content = { keys: [{ key: 'join', arms: ['control'], label: 'CTA' }], unchecked: [] }
  const base = { experiment, placements: [{ collection: 'pages', id: 1, title: 'Page', published: true, slots: { control: 1, variantA: 1, variantB: 0, variantC: 0 } }], metrics: [{ id: 2, source: 'click:join', name: 'Join' }], goalContent: content }
  expect(checkStart(base).filter(c => !c.ok).map(c => c.code)).toEqual(['goal-in-some-versions'])
  expect(checkStart({ ...base, goalContent: { ...content, keys: [] } }).filter(c => !c.ok)).toEqual([])
  expect(checkStart({ ...base, goalContent: { ...content, keys: [{ ...content.keys[0]!, arms: ['control', 'variantA'] }] } }).filter(c => !c.ok)).toEqual([])
  expect(checkStart({ ...base, experiment: { ...experiment, metrics: { primary: 3, secondary: [2] } }, metrics: [...base.metrics, { id: 3, source: 'events:signup' }] })).toContainEqual(expect.objectContaining({ code: 'goal-in-some-versions', ok: true, warning: true }))
  expect(checkStart({ ...base, experiment: { ...experiment, metrics: { primary: 3, guardrails: [2] } }, metrics: [...base.metrics, { id: 3, source: 'events:signup' }] })).toContainEqual(expect.objectContaining({ code: 'goal-in-some-versions', ok: false }))
})
test('page and Puck keys use published inline content; multi-placement union and holdout match rendered arms', async () => {
  const options = sampleOptions()
  options.pages = { collections: [{ slug: 'pages', pathOf: doc => String(doc.path), findByPath: async path => ({ id: path === '/a' ? 1 : 2, published: true }), contentOf: doc => doc.layout }] }
  const payload = fakePayload({ config: { collections: [{ slug: 'pages', versions: { drafts: true } }] }, collections: { pages: [
    { id: 1, _status: 'published', layout: [{ xpGoal: 'join', blockType: 'cta' }] }, { id: 2, _status: 'published', layout: [] },
    { id: 3, _status: 'published', puckData: { content: [{ type: 'ExperimentSlot', props: { experiment: 'fair', control: [{ type: 'CTA', props: { xpGoal: 'join' } }], variantA: [] } }] } },
    { id: 4, _status: 'published', puckData: { content: [{ type: 'ExperimentSlot', props: { experiment: 'fair', control: [], variantA: [{ type: 'CTA', props: { xpGoal: 'join' } }] } }] } },
  ] } })
  const req = fakeReq({ payload })
  const page = await goalContent(req, options, { ...experiment, kind: 'page', pageCollection: 'pages', arms: arms.map((a, i) => ({ ...a, pageTarget: i ? '/b' : '/a' })) })
  expect(asymmetricGoal(page, 'click:join', arms)).toBe(true)
  options.puck = { enabled: true, collections: ['pages'] }
  const union = await goalContent(req, options, experiment, [{ collection: 'pages', id: 3 }, { collection: 'pages', id: 4 }])
  expect(union.keys[0]!.arms).toEqual(['control', 'variantA'])
  expect(asymmetricGoal(union, 'click:join', arms)).toBe(false)
  expect(await goalContent(req, options, experiment, null)).toMatchObject({ skipped: true, keys: [] })
  const find = vi.spyOn(payload.db, 'findOne').mockRejectedValue(new Error('unreadable'))
  const unchecked = await goalContent(req, options, experiment, [{ collection: 'pages', id: 3 }])
  expect(unchecked.unchecked).toEqual([{ collection: 'pages', id: 3 }])
  expect(checkStart({ experiment, metrics: [], goalContent: unchecked })).toContainEqual(expect.objectContaining({ code: 'placement-unchecked', ok: true, warning: true }))
  find.mockRestore()
  expect((await goalContent(req, options, experiment, [{ collection: 'pages', id: 999 }])).unchecked).toEqual([{ collection: 'pages', id: 999 }])
})
test('click-keys route uses the manager document and returns published keys and labels', async () => {
  const options = { ...sampleOptions(), blocks: { collections: [{ slug: 'pages', field: 'layout' }] } }
  const payload = fakePayload({ config: { collections: [{ slug: 'pages', fields: [] }] }, collections: { 'xp-experiments': [experiment], pages: [{ id: 7, layout: [{ blockType: 'xpExperiment', experiment: 'fair', slots: [{ slot: 'control', blocks: [{ blockType: 'cta', xpGoal: 'join' }] }] }] }] } })
  const req = fakeReq({ payload, routeParams: { id: 1 } })
  expect(await (await handleClickKeys(req, { options })).json()).toEqual({ keys: [{ key: 'join', arms: ['control'], label: 'cta' }] })
  expect(payload.calls[0]).toMatchObject({ method: 'findByID', args: { overrideAccess: false, req } })
  expect(sanitizeReadinessDetail('goal-in-some-versions', { metricId: 1, name: 'private' })).toEqual([{ metricId: 1 }])
  expect(sanitizeReadinessDetail('placement-unchecked', { collection: 'pages', id: 7, title: 'private', path: '/ok' })).toEqual({ collection: 'pages', id: 7, path: '/ok' })
})
