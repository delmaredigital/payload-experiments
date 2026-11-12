import { expect, test } from 'vitest'
import { armsFromBlock, currentPuckDocument, isSharedTest, bannerFor, isSlugCollision, newTestBody, slugify, tabsFor, uniqueSlug } from '../../../src/puck/editor/editor.model.js'
import { defaultArms } from '../../../src/collections/experiments/armInvariants.js'
import type { Arm } from '../../../src/types/contracts.js'

const arms: Arm[] = [
  { key: 'control', kind: 'control', label: 'Original', weight: 25 },
  { key: 'variantA', kind: 'variant', label: 'New headline', weight: 25 },
  { key: 'variantB', kind: 'variant', label: '', weight: 25 },
  { key: 'variantC', kind: 'variant', label: 'Last idea', weight: 25 },
]

test.each([2, 3, 4])('%s groups preserve order, stored labels, and fixed fallbacks', count => {
  expect(tabsFor({ arms: arms.slice(0, count) })).toEqual([
    { slot: 'control', label: 'Original' }, { slot: 'variantA', label: 'New headline' },
    { slot: 'variantB', label: 'Variant B' }, { slot: 'variantC', label: 'Last idea' },
  ].slice(0, count))
})

test('holdout has no tab; unbound renders Original', () => {
  expect(tabsFor({ arms: [...arms, { key: 'holdout', kind: 'holdout', label: 'Holdout' }] })).toHaveLength(4)
  expect(tabsFor(null)).toEqual([{ slot: 'control', label: 'Original' }])
  expect(tabsFor()).toEqual(tabsFor(null))
})

test.each([
  ['draft', 'This block shows the Original to everyone until the test starts.'],
  ['stopped', 'This block shows the Original to everyone until the test starts.'],
  ['running', 'Changing this content mid-test mixes two versions in one result'],
  ['decided', "Decided: New headline. Use 'Make it the content' on the test to finish."],
  ['archived', 'This test is archived; the winning content is shown to everyone.'],
  [undefined, 'Choose or create a test to show different versions.'],
] as const)('banner for %s', (status, text) => {
  expect(bannerFor(status, 'New headline')).toBe(text)
})

test.each([
  ['  Héllo, WÖRLD! ', 'hello-world'], ['FOO___bar / baz', 'foo-bar-baz'],
  ['你好 !', ''], ['a'.repeat(70), 'a'.repeat(64)], ['a'.repeat(63) + ' b', 'a'.repeat(63)],
])('slugify %s', (input, expected) => { expect(slugify(input)).toBe(expected) })

test.each(['block', 'flag'] as const)('new %s body supplies every creation default', kind => {
  const result = newTestBody({ kind, name: 'Welcome', slug: 'welcome', unitType: 'visitor' })
  expect(result).toEqual({ name: 'Welcome', slug: 'welcome', kind, unitType: 'visitor',
    exposurePolicy: kind === 'block' ? 'render' : 'manual', arms: defaultArms(kind), allocation: 100,
    analysis: { plannedDurationDays: 28 } })
  expect(result).not.toHaveProperty('flagPoint')
  expect(result).not.toHaveProperty('layer')
  expect(result).not.toHaveProperty('hypothesis')
  result.arms[0]!.weight = 0
  expect(newTestBody({ kind, name: 'Again', slug: 'again', unitType: 'visitor' }).arms[0]!.weight).toBe(50)
})
test.each([12, 'uuid-layer'])('creation preserves the optional relationship id %s', layer => {
  expect(newTestBody({ kind: 'flag', name: 'Ask', slug: 'ask', unitType: 'user', flagPoint: 'ask', layer, hypothesis: 'More responses' }))
    .toMatchObject({ flagPoint: 'ask', layer, hypothesis: 'More responses', unitType: 'user' })
})
test.each([
  ['hello', [], 'hello'], ['hello', ['hello', 'hello-2', 'hello-4'], 'hello-3'],
  ['', [], 'test'], ['', ['test'], 'test-2'],
  ['x'.repeat(70), [], 'x'.repeat(64)],
  ['x'.repeat(64), ['x'.repeat(64)], 'x'.repeat(62) + '-2'],
  ['x'.repeat(61) + '-yy', ['x'.repeat(61) + '-yy'], 'x'.repeat(61) + '-2'],
  ['x'.repeat(64), ['x'.repeat(64), ...Array.from({ length: 8 }, (_, i) => 'x'.repeat(62) + `-${i + 2}`)], 'x'.repeat(61) + '-10'],
])('uniqueSlug chooses an available bounded slug', (base, taken, expected) => {
  const slug = uniqueSlug(base as string, taken as string[])
  expect(slug).toBe(expected)
  expect(slug.length).toBeLessThanOrEqual(64)
  expect(slug).not.toMatch(/-$/)
})
test('only a slug uniqueness 400 can be retried', () => {
  const body = { errors: [{ data: { errors: [{ path: 'slug', message: 'Value must be unique' }] } }] }
  expect(isSlugCollision(400, body)).toBe(true)
  expect(isSlugCollision(403, body)).toBe(false)
  expect(isSlugCollision(400, { errors: [{ message: 'Name is required' }] })).toBe(false)
  expect(isSlugCollision(400, { errors: [{ data: { errors: [{ path: 'slug', message: 'Required' }] } }] })).toBe(false)
})

test('Original comes first even when stored later; labels are trimmed with neutral fallbacks', () => {
  expect(tabsFor({ arms: [
    { key: 'variantB', kind: 'variant', label: '   ' },
    { key: 'variantA', kind: 'variant', label: '  Short headline  ' },
    { key: 'control', kind: 'control', label: ' Original ' },
    { key: 'holdout', kind: 'holdout', label: 'Holdout' },
  ] })).toEqual([
    { slot: 'control', label: 'Original' },
    { slot: 'variantB', label: 'Variant B' },
    { slot: 'variantA', label: 'Short headline' },
  ])
})


test('new block arms union existing versions and populated slots in order, without holdout or old settings', () => {
  const current = { arms: [
    { ...arms[3]!, label: 'Last idea', weight: 5, params: { old: true } },
    { ...arms[0]!, label: 'Current page', weight: 80 },
    { key: 'holdout' as const, kind: 'holdout' as const, label: 'Holdout', weight: 15 },
  ] }
  const before = structuredClone(current)
  const mirrored = armsFromBlock(current, { variantB: [{ type: 'Text' }], variantA: [] })
  expect(mirrored).toEqual([
    { key: 'control', kind: 'control', slot: 'control', label: 'Current page', weight: 34 },
    { key: 'variantB', kind: 'variant', slot: 'variantB', label: 'Variant B', weight: 33 },
    { key: 'variantC', kind: 'variant', slot: 'variantC', label: 'Last idea', weight: 33 },
  ])
  expect(current).toEqual(before)
  const body = newTestBody({ name: 'Copy', slug: 'copy', kind: 'block', unitType: 'visitor', arms: mirrored })
  expect(body.arms).toEqual(mirrored)
  expect(body.arms).not.toBe(mirrored)
  expect(body).not.toHaveProperty('decision')
  expect(body).not.toHaveProperty('metrics')
  expect(body).not.toHaveProperty('targeting')
  expect(body).not.toHaveProperty('startedAt')
})

test.each([1, 2, 3, 4])('mirroring %s versions always includes Original and splits 100 with whole weights', count => {
  const mirrored = armsFromBlock({ arms: arms.slice(1, count) }, {})
  expect(mirrored.map(arm => arm.key)).toEqual(arms.slice(0, count).map(arm => arm.key))
  expect(mirrored.reduce((sum, arm) => sum + arm.weight, 0)).toBe(100)
  expect(Math.max(...mirrored.map(arm => arm.weight)) - Math.min(...mirrored.map(arm => arm.weight))).toBeLessThanOrEqual(1)
})

test('shared placements count separate blocks or pages, excluding duplicate draft/published versions', () => {
  const page = { collection: 'pages', id: 1, title: 'Page', ok: true, detail: 'Published' }
  expect(isSharedTest([])).toBe(false)
  expect(isSharedTest([page])).toBe(true)
  const current = { collection: 'pages', id: '1' }
  expect(isSharedTest([page], current)).toBe(false)
  expect(isSharedTest([page, { ...page, id: '1', detail: 'Draft' }], current)).toBe(false)
  expect(isSharedTest([page, page], current)).toBe(false)
  expect(isSharedTest([page, { ...page, id: 2 }])).toBe(true)
  expect(isSharedTest([page, { ...page, collection: 'articles' }])).toBe(true)
})


test('current document can match either saved version’s custom editor pathname', () => {
  const page = { collection: 'pages', id: 1, title: 'Page', ok: true, detail: 'Published', editorUrl: '/content/published/one' }
  const placements = [page, { ...page, detail: 'Draft', editorUrl: '/content/drafts/one?mode=edit' }]
  const current = currentPuckDocument('/content/drafts/one', '/admin', placements)
  expect(current).toEqual({ collection: 'pages', id: '1' })
  expect(isSharedTest(placements, current)).toBe(false)
  expect(currentPuckDocument('/manage/puck/pages/id%2Fone/edit', '/manage')).toEqual({ collection: 'pages', id: 'id/one' })
  expect(currentPuckDocument('/admin/puck-editor/pages/create', '/admin')).toBeUndefined()
  expect(currentPuckDocument('/admin/puck-editor/pages/%', '/admin')).toBeUndefined()
})
