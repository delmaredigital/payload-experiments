import { expect, test } from 'vitest'
import { fullyHidden, hiddenOnSizes, walkVisiblePuck } from '../../src/puck/visibility.js'
import { localPlacements, localBlockVisibility } from '../../src/puck/editor/localPlacements.js'
import { placementSlugs } from '../../src/blocks/bindings.js'
import type { Data } from '@puckeditor/core'

const block = (id: string, visibility?: unknown) => ({ type: 'ExperimentSlot', props: { id, experiment: { id: 1, slug: 'hero' }, _visibility: visibility } })
test.each([undefined, null, false, 1, 'hidden', [], {}, { hidden: 'true' }, { hidden: false }, { hideOn: 'phone' }, { hideOn: ['watch'] }])('missing or malformed visibility is shown: %j', value => {
  expect(fullyHidden(value)).toBe(false)
  expect(hiddenOnSizes(value)).toEqual([])
})
test('hidden and every size are fully hidden; sizes are canonical and deduplicated', () => {
  expect(fullyHidden({ hidden: true })).toBe(true)
  expect(fullyHidden({ hideOn: ['desktop', 'phone', 'tablet', 'phone'] })).toBe(true)
  expect(fullyHidden({ hideOn: ['phone', 'tablet'] })).toBe(false)
  expect(hiddenOnSizes({ hideOn: ['tablet', 'phone', 'phone', null, 'bogus'] })).toEqual(['phone', 'tablet'])
  expect(fullyHidden({ hideOn: ['phone', 'tablet', 'desktop', 'bogus'] })).toBe(true)
})
test.each(['slot', 'zone'] as const)('a hidden ancestor through a %s removes a placement from local state and save discovery', location => {
  const child = block('child')
  const data = { root: { props: {} }, content: [block('shown'), { type: 'Container', props: { id: 'parent', _visibility: { hidden: true },
    ...(location === 'slot' ? { children: [child] } : {}) } }], zones: location === 'zone' ? { 'parent:children': [child] } : undefined } as Data
  const nodes = new Map<string, boolean>()
  walkVisiblePuck(data, (node, visibility) => nodes.set(String(node.props.id), visibility.hidden))
  expect(nodes.get('child')).toBe(true)
  expect(localBlockVisibility(data, 'child')?.hidden).toBe(true)
  expect([...localPlacements(data).get('1')!]).toEqual(['shown'])
  expect(placementSlugs({ puck: { enabled: true, collections: ['pages'] } }, 'pages', { puckData: data })).toEqual(['hero'])
  data.content.shift()
  expect(placementSlugs({ puck: { enabled: true, collections: ['pages'] } }, 'pages', { puckData: data })).toEqual([])
})
test('partial visibility remains a placement; Payload blocks ignore the Puck contract', () => {
  expect(placementSlugs({ puck: { enabled: true, collections: ['pages'] } }, 'pages', { puckData: { content: [block('partial', { hideOn: ['phone'] })] } })).toEqual(['hero'])
  expect(placementSlugs({ blocks: { collections: [{ slug: 'pages', field: 'layout' }] } }, 'pages', {
    layout: [{ blockType: 'xpExperiment', experiment: 'hero', _visibility: { hidden: true } }],
  })).toEqual(['hero'])
})

test('localized hidden-copy discovery merges a flattened update into the locale views', async () => {
  const { blockRemovalRule } = await import('../../src/hooks/blockRemovalRule.js')
  const { fakeReq } = await import('../_fakes/req.js')
  const { fakePayload } = await import('../_fakes/payload.js')
  const options = { puck: { enabled: true, collections: ['pages'] } }
  const payload = fakePayload({ config: { custom: { xp: options },
    localization: { defaultLocale: 'en', localeCodes: ['en', 'fr'], locales: [{ code: 'en' }, { code: 'fr' }], fallback: true },
    collections: [{ slug: 'pages', fields: [{ name: 'puckData', type: 'json', localized: true }] }],
  } })
  const req = fakeReq({ payload }); req.locale = 'en'
  const before = { puckData: { en: { content: [block('one')] }, fr: { content: [] } } }
  const after = { puckData: { content: [block('one', { hidden: true })] } }
  const result = await blockRemovalRule.prepare(req, 'pages', before, after, false, undefined, [])
  expect([...result.hidden]).toEqual(['hero'])
  expect(result.views.has('hero')).toBe(true)
})

test('a modern slot named zones is traversed normally', () => {
  const data = { content: [{ type: 'Container', props: { id: 'container', zones: [block('shown'), block('hidden', { hidden: true })] } }] }
  const states = new Map<string, boolean>()
  walkVisiblePuck(data, (node, visibility) => states.set(String(node.props.id), visibility.hidden))
  expect([...states]).toEqual([['container', false], ['shown', false], ['hidden', true]])
  expect(placementSlugs({ puck: { enabled: true, collections: ['pages'] } }, 'pages', { puckData: data })).toEqual(['hero'])
})


test('local placement memoization depends only on immutable page data', () => {
  const data = { root: { props: {} }, content: [block('shown')] } as Data
  expect(localPlacements.length).toBe(1)
  expect(localPlacements(data)).toBe(localPlacements(data))
  const changed = { ...data, content: [...data.content, block('second')] }
  expect(localPlacements(changed)).not.toBe(localPlacements(data))
})
