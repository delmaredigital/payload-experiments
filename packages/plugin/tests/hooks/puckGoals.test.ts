import { ValidationError, type CollectionBeforeChangeHook, type Config } from 'payload'
import { beforeEach, expect, test, vi } from 'vitest'
import { definedClickKeys } from '../../src/db/clickGoals.js'
import { clickKeys } from '../../src/goals/cache.js'
import { puckGoalsBeforeChange } from '../../src/hooks/puckGoals.js'
import { createExperimentsPlugin } from '../../src/plugin.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { sampleOptions } from '../collections/fixtures.js'

vi.mock('../../src/goals/cache.js', () => ({ clickKeys: vi.fn() }))
vi.mock('../../src/db/clickGoals.js', () => ({ definedClickKeys: vi.fn() }))
beforeEach(() => {
  vi.mocked(clickKeys).mockReset().mockResolvedValue(new Set(['join']))
  vi.mocked(definedClickKeys).mockReset().mockResolvedValue(new Set())
})

// Measured related run: slowest case 5.261 ms; each explicit 3,000 ms cap exceeds 3×.
const missing = 'No click goal has this name yet. Create it with "+ New click goal".'
const grammar = 'Use a click goal short name.'
function fixture({ drafts = true, manager = true, configured = true, field = 'puckData' } = {}) {
  const options = sampleOptions()
  const manage = vi.fn(async () => manager)
  options.access.manage = manage
  const payload = fakePayload({ config: { custom: configured ? { xp: options } : {} } })
  const req = fakeReq({ payload })
  const hook = puckGoalsBeforeChange(field)
  return { payload, req, manage, save(data: Record<string, unknown>, operation: 'create' | 'update' = 'update', originalDoc?: Record<string, unknown>) {
    return hook({ collection: { slug: 'pages', ...(drafts ? { versions: { drafts: {} } } : {}) }, data, originalDoc, req, operation } as Parameters<CollectionBeforeChangeHook>[0])
  } }
}
function refused(path: string, message = missing) {
  return { name: 'ValidationError', data: { collection: 'pages', errors: [{ path, message }] } }
}

test.each(['draft', undefined])('draft-enabled write with status %s skips lookup', async status => {
  const f = fixture(), data = { _status: status, puckData: { props: { xpGoal: 'missing' } } }
  expect(await f.save(data)).toBe(data)
  expect(f.manage).not.toHaveBeenCalled()
  expect(clickKeys).not.toHaveBeenCalled()
}, 3_000)

test('published write refuses an undefined goal with its exact path and copy', async () => {
  const pending = fixture().save({ _status: 'published', puckData: { content: [{}, {}, { props: { xpGoal: 'missing' } }] } })
  await expect(pending).rejects.toBeInstanceOf(ValidationError)
  await expect(pending).rejects.toMatchObject(refused('puckData.content.2.props.xpGoal'))
}, 3_000)

test('publishing a stored draft without its JSON checks the stored JSON', async () => {
  const stored = { puckData: { content: [{ props: { xpGoal: 'missing' } }] } }
  await expect(fixture().save({ _status: 'published' }, 'update', stored)).rejects.toMatchObject(refused('puckData.content.0.props.xpGoal'))
  const data = {}
  expect(await fixture({ drafts: false }).save(data, 'update', stored)).toBe(data)
}, 3_000)

test.each(['create', 'update'] as const)('no-drafts %s checks every save', async operation => {
  await expect(fixture({ drafts: false }).save({ puckData: { props: { xpGoal: 'missing' } } }, operation))
    .rejects.toMatchObject(refused('puckData.props.xpGoal'))
}, 3_000)

test('defined goals at root, content, zones and nested prop arrays all save', async () => {
  const data = { _status: 'published', puckData: {
    root: { props: { xpGoal: 'join' } },
    content: [{ props: { xpGoal: 'join', cta: { slots: [{ xpGoal: 'join' }] } } }],
    zones: { 'hero:main': [{ props: { cta: { xpGoal: 'join' } } }] },
  } }
  expect(await fixture().save(data)).toBe(data)
  expect(clickKeys).toHaveBeenCalledTimes(4)
  expect(definedClickKeys).not.toHaveBeenCalled()
}, 3_000)

test('two bad props produce two errors with their full paths', async () => {
  await expect(fixture().save({ _status: 'published', puckData: {
    root: { props: { xpGoal: 'missing' } }, zones: { 'hero:main': [{ props: { cta: { xpGoal: 'BAD' } } }] },
  } })).rejects.toMatchObject({ data: { errors: [
    { path: 'puckData.root.props.xpGoal', message: missing },
    { path: 'puckData.zones.hero:main.0.props.cta.xpGoal', message: grammar },
  ] } })
}, 3_000)

test('grammar refusal precedes even the non-manager access check', async () => {
  const f = fixture({ manager: false })
  await expect(f.save({ _status: 'published', puckData: { props: { xpGoal: 'BAD' } } }))
    .rejects.toMatchObject(refused('puckData.props.xpGoal', grammar))
  expect(f.manage).not.toHaveBeenCalled()
  expect(clickKeys).not.toHaveBeenCalled()
}, 3_000)

test.each([{ manager: false }, { configured: false }])('no manager or config skips the lookup: %j', async settings => {
  const f = fixture(settings), data = { _status: 'published', puckData: { props: { xpGoal: 'missing' } } }
  expect(await f.save(data)).toBe(data)
  expect(clickKeys).not.toHaveBeenCalled()
  if (settings.manager === false) expect(f.manage).toHaveBeenCalledWith({ req: f.req })
}, 3_000)

test('cache failure without a previous set allows publishing', async () => {
  vi.mocked(clickKeys).mockResolvedValue(undefined)
  const data = { _status: 'published', puckData: { props: { xpGoal: 'missing' } } }
  expect(await fixture().save(data)).toBe(data)
  expect(definedClickKeys).not.toHaveBeenCalled()
}, 3_000)

test('a fresh pooled read accepts a key missing from cache without Local API calls', async () => {
  vi.mocked(definedClickKeys).mockResolvedValue(new Set(['new-goal']))
  const f = fixture(), data = { _status: 'published', puckData: { props: { xpGoal: 'new-goal' } } }
  expect(await f.save(data)).toBe(data)
  expect(definedClickKeys).toHaveBeenCalledOnce()
  expect(f.payload.calls).toEqual([])
}, 3_000)

test('a failed fresh lookup propagates the original error', async () => {
  const error = new Error('pooled read failed')
  vi.mocked(definedClickKeys).mockRejectedValue(error)
  await expect(fixture().save({ _status: 'published', puckData: { props: { xpGoal: 'missing' } } })).rejects.toBe(error)
}, 3_000)

test.each([{}, { puckData: '{bad json' }, { puckData: null }, { puckData: { props: { xpGoal: '' } } },
  { puckData: { props: { xpGoal: 7, nested: { xpGoal: { label: 'missing' } } } } }])('absent, malformed and non-string goals do no lookup: %j', async value => {
  const f = fixture(), data = { _status: 'published', ...value }
  expect(await f.save(data)).toBe(data)
  expect(f.manage).not.toHaveBeenCalled()
  expect(clickKeys).not.toHaveBeenCalled()
}, 3_000)

test('JSON strings use the registered custom field and are checked', async () => {
  await expect(fixture({ field: 'contentJson' }).save({ _status: 'published', contentJson: JSON.stringify({ props: { xpGoal: 'missing' } }) }))
    .rejects.toMatchObject(refused('contentJson.props.xpGoal'))
}, 3_000)

test('only enabled Puck registrations append the goal hook after existing hooks', async () => {
  const options = sampleOptions(), host = vi.fn()
  options.puck = { enabled: true, collections: [{ slug: 'puck', field: 'contentJson' }] }
  options.pages = { collections: [{ slug: 'pages', pathOf: () => '/', findByPath: async () => null }] }
  options.blocks = { collections: [{ slug: 'blocks', field: 'layout' }] }
  const input = { collections: ['puck', 'pages', 'blocks'].map(slug => ({ slug, fields: [], hooks: { beforeChange: [host] } })) } as unknown as Config
  const config = await createExperimentsPlugin(options)(input)
  const hooks = config.collections!.slice(0, 3).map(c => c.hooks!.beforeChange!)
  expect(hooks.map(h => h.length)).toEqual([4, 3, 3])
  expect(hooks[0]!.slice(0, 3)).toEqual(hooks[1])
  const f = fixture({ drafts: false })
  await expect(hooks[0]![3]!({ collection: { slug: 'pages' }, context: f.req.context, operation: 'update', data: { contentJson: { props: { xpGoal: 'missing' } } }, req: f.req } as unknown as Parameters<CollectionBeforeChangeHook>[0]))
    .rejects.toMatchObject(refused('contentJson.props.xpGoal'))
  options.puck.enabled = false
  const disabled = await createExperimentsPlugin(options)(input)
  expect(disabled.collections![0]).toBe(input.collections![0])
}, 3_000)
