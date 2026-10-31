import { expect, test } from 'vitest'
import { bannerFor, slugify, tabsFor } from '../../../src/puck/editor/editor.model.js'
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
  ['draft', 'This block shows the Original to everyone until the experiment starts.'],
  ['stopped', 'This block shows the Original to everyone until the experiment starts.'],
  ['running', 'Changing this content mid-test mixes two versions in one result'],
  ['decided', "Decided: New headline. Use 'Make it the content' on the experiment to finish."],
  ['archived', 'This experiment is archived; the winning content is shown to everyone.'],
  [undefined, 'Choose or create an experiment to show different versions.'],
] as const)('banner for %s', (status, text) => {
  expect(bannerFor(status, 'New headline')).toBe(text)
})

test.each([
  ['  Héllo, WÖRLD! ', 'hello-world'], ['FOO___bar / baz', 'foo-bar-baz'],
  ['你好 !', ''], ['a'.repeat(70), 'a'.repeat(64)], ['a'.repeat(63) + ' b', 'a'.repeat(63)],
])('slugify %s', (input, expected) => { expect(slugify(input)).toBe(expected) })
