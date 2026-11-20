import type { Config, Data } from '@puckeditor/core'
import { createElement } from 'react'
import { getBlockVisibility, isBlockHidden, isBlockHiddenOn, SCREEN_SIZES, walkShownBlocks } from '@delmaredigital/payload-puck/visibility'
import { expect, test } from 'vitest'
import { fullyHidden, hiddenOnSizes } from '../../src/puck/visibility.js'
import { localPlacements, localBlockVisibility } from '../../src/puck/editor/localPlacements.js'
import { placementSlugs } from '../../src/blocks/bindings.js'
import { resolveExperimentData } from '../../src/server/resolveExperimentData.js'
import { assignments } from '../rsc/helpers.js'

const values: unknown[] = [undefined, null, false, true, 1, 'hidden', [], {}, { hidden: 'true' }, { hidden: 1 },
  { hideOn: 'phone' }, { hideOn: [null, 1, {}, 'watch'] }, { hideOn: ['phone', 'watch', 'phone'] },
  { hidden: true }, { hidden: true, hideOn: ['phone'] }, { hideOn: ['desktop', 'phone', 'tablet', 'phone', 'watch'] },
  ...Array.from({ length: 8 }, (_, mask) => ({ hideOn: SCREEN_SIZES.filter((_, index) => mask & (1 << index)) })),
]
const slot = (_visibility: unknown) => ({ type: 'ExperimentSlot', props: { id: 'test', experiment: { id: 7, slug: 'hero' }, _visibility, control: [{ type: 'Text', props: { id: 'original', text: 'Original' } }], variantA: [{ type: 'Text', props: { id: 'variant', text: 'Variant' } }], variantB: [], variantC: [] } })
const config: Config = { components: {
  ExperimentSlot: { fields: { control: { type: 'slot' }, variantA: { type: 'slot' } }, render: () => createElement('div') },
  Text: { render: () => createElement('div') },
  Container: { fields: { children: { type: 'slot' }, items: { type: 'array', arrayFields: { content: { type: 'slot' } } }, group: { type: 'object', objectFields: { content: { type: 'slot' } } } }, render: () => createElement('div') },
} }
const options = { puck: { enabled: true, collections: ['pages'] } }

function assertPlacementContract(data: Data) {
  const shown: string[] = []
  walkShownBlocks(data, config, block => { if (block.type === 'ExperimentSlot') shown.push(block.props.id) })
  const visible = shown.includes('test')
  expect(localBlockVisibility(data, 'test')?.hidden).toBe(!visible)
  expect([...(localPlacements(data).get('7') ?? [])]).toEqual(shown)
  expect(placementSlugs(options, 'pages', { puckData: data })).toEqual(visible ? ['hero'] : [])
  const result = resolveExperimentData(data, assignments())
  const resolved: string[] = []
  walkShownBlocks(result.data, config, block => { if (block.type === 'ExperimentSlot') resolved.push(block.props.id) })
  expect(resolved).toEqual(shown)
  expect(result.rendered).toEqual(visible ? [{ slug: 'hero', phase: 1, arm: 'variantA' }] : [])
  if (!visible) expect(JSON.stringify(result.data)).not.toContain('"id":"test"')
}

test.each(values.map((value, index) => ({ value, index })))('own visibility agrees with published helpers (fixture $index: $value)', ({ value }) => {
  const block = slot(value)
  const actual = getBlockVisibility(block)
  expect(fullyHidden(value)).toBe(actual.hidden)
  expect(fullyHidden(value)).toBe(isBlockHidden(block))
  expect(actual.hidden ? [] : hiddenOnSizes(value)).toEqual(actual.hideOn)
  for (const size of SCREEN_SIZES) expect(fullyHidden(value) || hiddenOnSizes(value).includes(size)).toBe(isBlockHiddenOn(block, size))
  assertPlacementContract({ root: { props: {} }, content: [block] })
})

test.each(['slot', 'zone', 'array', 'object'] as const)('ancestor and child visibility agree for every fixture pair through a %s', mode => {
  for (const parentVisibility of values) for (const childVisibility of values) {
    const child = slot(childVisibility)
    const parent = { type: 'Container', props: { id: 'parent', _visibility: parentVisibility,
      ...(mode === 'slot' ? { children: [child] } : mode === 'array' ? { items: [{ content: [child] }] } : mode === 'object' ? { group: { content: [child] } } : {}),
    } }
    const data = { root: { props: {} }, content: [parent], ...(mode === 'zone' ? { zones: { 'parent:children': [child] } } : {}) } as Data
    // Report the exact stored pair if either implementation changes its contract.
    expect(() => assertPlacementContract(data), JSON.stringify({ mode, parentVisibility, childVisibility })).not.toThrow()
    const local = localBlockVisibility(data, 'test')!
    for (const size of SCREEN_SIZES) expect(local.hidden || local.hideOn.includes(size), JSON.stringify({ mode, parentVisibility, childVisibility, size }))
      .toBe(isBlockHiddenOn(parent, size) || isBlockHiddenOn(child, size))
  }
})
