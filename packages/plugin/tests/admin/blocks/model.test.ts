import type { ClientConfig } from 'payload'
import { expect, test } from 'vitest'
import { blockChoices, statusSentence, slotLabel } from '../../../src/admin/blocks/model.js'
import { BLOCK_COPY, blockTestName } from '../../../src/admin/copy/blocks.js'
import { adaptClientBlocksField } from '../../../src/admin/blocks/formApi.js'
import { copyOriginalIntoVersion, unwrapExperimentBlock, wrapExperimentBlock } from '../../../src/blocks/formState.js'
import type { BlockStatus, LiveBlockStatus } from '../../../src/admin/blocks/model.js'
import { clientField, config, field, original } from './fixtures.js'
const live: LiveBlockStatus = { name: 'Hero test', kind: 'block', status: 'draft', arms: [{ key: 'control', label: 'Original' }, { key: 'variantA', label: 'New hero' }], rollout: false }
test('picker labels position, excludes wrappers, and name excludes position', () => {
  const choices = blockChoices([wrapExperimentBlock(original, 'test', field), original, { blockType: 'plain' }], field, 'xpExperiment')
  expect(choices.map(choice => choice.option)).toEqual(['Hero (block 2)', 'plain (block 3)'])
  expect(blockTestName('About us', choices[0]!.label)).toBe('About us: Hero')
  expect(BLOCK_COPY.empty).toBe('There are no blocks on this page to test yet. Add one, save, then come back.')
})
test.each([
  [{ ...live }, 'This block is being tested in the draft test Hero test. Visitors see the Original until it starts.'],
  [{ ...live, status: 'running' }, "Running: visitors see different versions. Edit a version's tab to change it; the change is noted on the results."],
  [{ ...live, status: 'stopped' }, 'Stopped: visitors see the Original.'],
  [{ ...live, status: 'decided', winnerArm: 'variantA' }, 'Decided: visitors see New hero.'],
  [{ ...live, status: 'decided', winnerArm: 'variantA', rollout: true }, 'Decided: visitors see New hero; a holdout still sees the Original.'],
  [{ ...live, status: 'archived', winnerArm: 'variantA' }, 'Archived: this block keeps serving New hero, with the Original as a fallback if it is empty. To replace it, copy the content into ordinary page blocks, then remove this Experiment block. View the results on the test.'],
  [{ ...live, status: 'archived', winnerArm: 'variantA', discarded: true }, 'Winner discarded: this block shows the Original. Use Unwrap to replace it with the Original content.'],
  [{ ...live, status: 'archived' }, 'Archived without a winner: this block shows the Original. Use Unwrap to replace it with the Original content.'],
  [{ missing: true }, "This block's test was deleted; the page shows the Original."],
  [{ deleted: true }, "This block's test was deleted; the page shows the Original."],
] as Array<[BlockStatus, string]>)('status %j uses authored sentence', (status, sentence) => expect(statusSentence(status)).toBe(sentence))
test('labels use test labels then slot vocabulary', () => {
  expect(slotLabel('variantA', live)).toBe('New hero')
  expect(slotLabel('variantB', live)).toBe('Variant B')
  expect(slotLabel('control', null)).toBe('Original')
})
test('client adapter traverses nested arrays/blocks and resolves global references inside slots', () => {
  const globals = [clientField.blocks[0]!]
  const referenced = { ...clientField, blocks: clientField.blocks.slice(1), blockReferences: ['hero'] }
  const adapted = adaptClientBlocksField(referenced, { blocks: globals as unknown as ClientConfig['blocks'] })
  const wrapped = wrapExperimentBlock(original, 'test', adapted)
  for (const row of [wrapped.slots[1]!.blocks[0]!, unwrapExperimentBlock(wrapped, adapted)[0]!, copyOriginalIntoVersion(wrapped, 'variantA', adapted).slots[1]!.blocks[0]!]) {
    expect(row.id).not.toBe(original.id)
    expect((row.items as any)[0].id).not.toBe('nested-array')
    expect((row.children as any)[0].id).not.toBe('nested-block')
  }
  expect(original.id).toBe('hero-id')
})
