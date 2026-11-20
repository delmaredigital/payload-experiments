import { expect, test } from 'vitest'
import { nestedTests, nestedTestKey, nearestOuterTest } from '../../src/puck/nestedTests.js'
import { walkVisiblePuck } from '../../src/puck/visibility.js'
import { refuseNewNestedTests } from '../../src/hooks/puckNestedTests.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { sampleOptions } from '../collections/fixtures.js'

const testBlock = (id: string, content: unknown[] = [], visibility = {}) => ({ type: 'ExperimentSlot', props: {
  id, experiment: { id, slug: id }, control: content, _visibility: visibility,
} })
const container = (children: unknown[], visibility = {}) => ({ type: 'Container', props: { id: 'container', children, _visibility: visibility } })
const page = (content: unknown[]) => ({ root: { props: {} }, content })
const pairs = (data: unknown) => nestedTests(data).map(pair => [pair.outer.props.id, pair.inner.props.id])

test('finds direct tests, containers and every pair at three levels', () => {
  expect(pairs(page([testBlock('outer', [testBlock('inner')])]))).toEqual([['outer', 'inner']])
  expect(pairs(page([testBlock('outer', [container([testBlock('middle', [testBlock('inner')])])])]))).toEqual([
    ['outer', 'middle'], ['outer', 'inner'], ['middle', 'inner'],
  ])
})
test.each([{ hidden: true }, { hideOn: ['phone', 'tablet', 'desktop'] }])('fully hidden inner tests follow placement visibility: %j', visibility => {
  const data = page([testBlock('outer', [testBlock('inner', [], visibility)])])
  expect(pairs(data)).toEqual([])
  expect(nestedTests(data, { includeHidden: true })).toHaveLength(1)
})
test('hidden ancestors do not count, while partial hiding still counts', () => {
  expect(pairs(page([testBlock('outer', [container([testBlock('inner')], { hidden: true })])]))).toEqual([])
  expect(pairs(page([testBlock('outer', [testBlock('inner', [], { hideOn: ['phone'] })])]))).toEqual([['outer', 'inner']])
})
test('legacy zones retain ancestry through containers; orphan zones remain roots', () => {
  const data = { ...page([testBlock('outer')]), zones: { 'outer:control': [container([])], 'container:children': [testBlock('inner')], 'orphan:content': [testBlock('other')] } }
  expect(pairs(data)).toEqual([['outer', 'inner']])
})
test('uses the same block shapes as placement discovery, even in opaque properties', () => {
  const data = page([testBlock('outer', [container([{ type: 'ExperimentSlot', text: 'not a Puck block' }, { metadata: testBlock('inner') }])])])
  const discovered: unknown[] = []
  walkVisiblePuck(data, block => discovered.push(block.props.id))
  expect(discovered).toContain('inner')
  expect(pairs(data)).toEqual([['outer', 'inner']])
})
test('pair identity survives content edits but changes on a new block or binding', () => {
  const pair = nestedTests(page([testBlock('outer', [testBlock('inner')])]))[0]!
  expect(nestedTestKey(pair)).toBe(nestedTestKey({ ...pair, inner: { ...pair.inner, props: { ...pair.inner.props, text: 'edit' } } }))
  expect(nestedTestKey(pair)).not.toBe(nestedTestKey({ ...pair, inner: testBlock('new') }))
})
test('publish compares canonical locale views, retaining old nesting and allowing untangling', () => {
  const options = sampleOptions()
  options.puck = { enabled: true, collections: ['pages'] }
  const payload = fakePayload({ config: { custom: { xp: options }, localization: { defaultLocale: 'en', localeCodes: ['en', 'es'], locales: ['en', 'es'] },
    collections: [{ slug: 'pages', fields: [{ name: 'puckData', type: 'json', localized: true }] }],
  } as never })
  const req = fakeReq({ payload })
  const flat = page([testBlock('outer'), testBlock('inner')])
  const nested = page([testBlock('outer', [testBlock('inner')])])
  const before = { puckData: { en: flat, es: nested } }
  expect(() => refuseNewNestedTests(req, 'pages', before, { ...before, title: 'edit' }, [])).not.toThrow()
  expect(() => refuseNewNestedTests(req, 'pages', before, { puckData: { en: flat, es: flat } }, [])).not.toThrow()
  expect(() => refuseNewNestedTests(req, 'pages', before, { puckData: { en: nested, es: nested } }, [])).toThrow('Move “inner”')
})


test('nearest ancestor wins for the newly added third level on publish', () => {
  const options = sampleOptions(); options.puck = { enabled: true, collections: ['pages'] }
  const req = fakeReq({ payload: fakePayload({ config: { custom: { xp: options } } }) })
  const before = { puckData: page([testBlock('A', [testBlock('B')])]) }
  const after = { puckData: page([testBlock('A', [testBlock('B', [testBlock('C')])])]) }
  expect(nearestOuterTest(nestedTests(after.puckData), 'C')?.props.id).toBe('B')
  expect(() => refuseNewNestedTests(req, 'pages', before, after, [])).toThrow('“C” is inside a version of “B”.')
})
test.each([true, false])('publish refusal handles an unconfigured inner and outer (outer named=%s)', named => {
  const options = sampleOptions(); options.puck = { enabled: true, collections: ['pages'] }
  const req = fakeReq({ payload: fakePayload({ config: { custom: { xp: options } } }) })
  const inner = { ...testBlock('inner'), props: { id: 'inner', experiment: null } }
  const outer = { ...testBlock('outer'), props: { id: 'outer', experiment: named ? { slug: 'Outer' } : null, control: [inner] } }
  expect(() => refuseNewNestedTests(req, 'pages', undefined, { puckData: page([outer]) }, []))
    .toThrow(named ? 'This test is inside a version of “Outer”.' : 'This test is inside a version of another test.')
})
