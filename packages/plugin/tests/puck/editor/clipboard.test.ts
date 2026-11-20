import type { BlockClipboardComponentOptions, CanPasteArgs } from '@delmaredigital/payload-puck/editor'
import { expect, test } from 'vitest'
import { canPasteExperiment } from '../../../src/puck/editor/blockClipboard.js'
import { ExperimentSlotEditor, createExperimentSlotEditor } from '../../../src/puck/editor/ExperimentSlotEditor.js'
import { editorCopy } from '../../../src/puck/editor/copy.js'

const block = (type: string, props = {}) => ({ type, props: { id: type, ...props } })
const experiment = block('ExperimentSlot')
const ancestor = { id: 'outer', type: 'ExperimentSlot', slot: 'control' }
const container = { id: 'container', type: 'Container', slot: 'children' }
const args = (pasted = experiment, ancestors: CanPasteArgs['destination']['ancestors'] = [ancestor]): CanPasteArgs => ({
  block: pasted, destination: { zone: `${ancestors[0]?.id ?? 'root'}:${ancestors[0]?.slot ?? 'default-zone'}`, index: 0, ancestors },
})

test.each(['control', 'variantA', 'variantB', 'variantC'])('refuses an Experiment under the %s version', slot => {
  expect(canPasteExperiment(args(experiment, [{ ...ancestor, slot }]))).toBe(editorCopy.nestedPaste)
})
test('refuses an Experiment beneath an intervening container, including when asked as the pasted type', () => {
  expect(canPasteExperiment(args(experiment, [container, ancestor]))).toBe(editorCopy.nestedPaste)
})
test.each([
  block('Container', { children: [experiment] }),
  block('Container', { items: [{ content: [block('Container', { children: [experiment] })] }] }),
  block('Container', { object: { nested: [experiment] } }),
  block('Container', { children: [block('ExperimentSlot', { experiment: null, _visibility: { hidden: true } })] }),
])('refuses a pasted tree containing an Experiment at any depth: %j', pasted => {
  expect(canPasteExperiment(args(pasted, [container, ancestor]))).toBe(editorCopy.nestedPaste)
})
test.each([experiment, block('Container', { children: [experiment] })])('allows a test tree on the page or in ordinary containers: %j', pasted => {
  expect(canPasteExperiment(args(pasted, []))).toBe(true)
  expect(canPasteExperiment(args(pasted, [container]))).toBe(true)
})
test.each([block('Text'), block('Container', { children: [block('Text')] }), block('RichText', { content: [{ type: 'ExperimentSlot', text: 'not a block' }] })])('allows ordinary version content: %j', pasted => {
  expect(canPasteExperiment(args(pasted, [container, ancestor]))).toBe(true)
})
test('does not change the copied tree or destination', () => {
  const value = args(block('Container', { children: [experiment] }), [container, ancestor])
  const before = structuredClone(value)
  canPasteExperiment(value)
  expect(value).toEqual(before)
})
test.each([ExperimentSlotEditor, createExperimentSlotEditor({ routes: { admin: '/manage' } })])('component installs the predicate with the published hook contract', config => {
  const hook: NonNullable<BlockClipboardComponentOptions['canPaste']> = canPasteExperiment
  expect(config).toHaveProperty('blockClipboard.canPaste', hook)
  // payload-puck asks nearest ancestors first, then the pasted block's own type.
  for (const asAncestor of [ancestor, undefined]) {
    expect(hook({ ...args(block('Container', { children: [experiment] })), ancestor: asAncestor })).toBe(editorCopy.nestedPaste)
  }
})
