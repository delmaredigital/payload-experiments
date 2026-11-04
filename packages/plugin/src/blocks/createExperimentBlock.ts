import type { Block } from 'payload'
import { BLOCK_SLOTS, EXPERIMENT_BLOCK_SLUG } from './model.js'

export function validateExperimentSlots(value: unknown): true | string {
  if (!Array.isArray(value)) return true
  const slots = value.map(row => row?.slot)
  return new Set(slots).size === slots.length ? true : 'Each version appears once'
}
export function createExperimentBlock({ blocks, slug = EXPERIMENT_BLOCK_SLUG }: { blocks: Block[]; slug?: string }): Block {
  if (blocks.some(block => block.slug === slug)) throw new Error('Experiment blocks cannot be nested.')
  return { slug, labels: { singular: 'Experiment', plural: 'Experiments' }, fields: [
    { name: 'experiment', type: 'text', required: true },
    { name: 'slots', type: 'array', validate: validateExperimentSlots, fields: [
      { name: 'slot', type: 'select', required: true, options: [...BLOCK_SLOTS] },
      { name: 'blocks', type: 'blocks', blocks },
    ] },
  ] }
}
