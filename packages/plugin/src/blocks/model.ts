import type { RenderedExposure } from '../types/assignments.js'

export const EXPERIMENT_BLOCK_SLUG = 'xpExperiment'
export const BLOCK_SLOTS = ['control', 'variantA', 'variantB', 'variantC'] as const
export interface HostBlock { id?: string; blockType: string; blockName?: string; [field: string]: unknown }
export interface ExperimentBlock extends HostBlock {
  experiment: string
  slots: Array<{ id?: string; slot: string; blocks: HostBlock[] }>
}
export interface ExperimentBlockGroup { slug: string; expose?: RenderedExposure }
export type ResolvedHostBlock = HostBlock & { xpGroup?: ExperimentBlockGroup }
export interface ResolvedExperimentBlocks {
  blocks: ResolvedHostBlock[]
  rendered: RenderedExposure[]
  groups: Array<ExperimentBlockGroup & { start: number; end: number }>
}
export const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export const hostBlocks = (v: unknown): HostBlock[] => Array.isArray(v) ? v.filter((b): b is HostBlock => isObject(b) && typeof b.blockType === 'string') : []
export function slotBlocks(block: HostBlock, slot: string): HostBlock[] {
  const row = Array.isArray(block.slots) ? block.slots.find(row => isObject(row) && row.slot === slot) : undefined
  return isObject(row) ? hostBlocks(row.blocks) : []
}

/** Experiments-off rendering preserves stored row ids; only top-level wrappers are read. */
export function controlOnlyBlocks(blocks: unknown, blockSlug = EXPERIMENT_BLOCK_SLUG): HostBlock[] {
  return hostBlocks(blocks).flatMap(block => block.blockType === blockSlug ? slotBlocks(block, 'control') : [block])
}
export function segmentExperimentBlocks(blocks: readonly ResolvedHostBlock[]): Array<{ group?: ExperimentBlockGroup; blocks: HostBlock[] }> {
  const runs: Array<{ group?: ExperimentBlockGroup; blocks: HostBlock[] }> = []
  for (const block of blocks) {
    const group = block.xpGroup, last = runs.at(-1)
    if (last && last.group === group) last.blocks.push(block)
    else runs.push({ ...(group ? { group } : {}), blocks: [block] })
  }
  return runs
}
