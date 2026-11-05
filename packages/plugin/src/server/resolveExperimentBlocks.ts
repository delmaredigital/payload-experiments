import type { Assignments } from '../types/assignments.js'
import { BLOCK_SLOTS, EXPERIMENT_BLOCK_SLUG, hostBlocks, slotBlocks, type ResolvedExperimentBlocks } from '../blocks/model.js'
import { manifestOf, suppressExposure } from './context.js'

export function resolveExperimentBlocks(blocks: unknown, assignments: Assignments, { blockSlug = EXPERIMENT_BLOCK_SLUG }: { blockSlug?: string } = {}): ResolvedExperimentBlocks {
  const result: ResolvedExperimentBlocks = { blocks: [], rendered: [], groups: [] }
  const exposed = new Set<string>()
  for (const block of hostBlocks(blocks)) {
    if (block.blockType !== blockSlug) { const clean = { ...block }; delete clean.xpGroup; result.blocks.push(clean); continue }
    const slug = typeof block.experiment === 'string' ? block.experiment : ''
    const assignment = Object.hasOwn(assignments.bySlug, slug) ? assignments.bySlug[slug] : undefined
    const experiment = manifestOf(assignments)?.experiments.find(e => e.slug === slug)
    const arm = experiment?.arms.find(a => a.key === assignment?.arm)
    const archived = Object.hasOwn(assignments.archivedWinners, slug) ? assignments.archivedWinners[slug] : undefined
    const slot = assignment ? assignment.arm === 'holdout' ? 'control' : arm?.slot ?? assignment.arm : archived ?? 'control'
    const selected = BLOCK_SLOTS.includes(slot as typeof BLOCK_SLOTS[number]) ? slotBlocks(block, slot) : []
    const content = selected.length ? selected : slotBlocks(block, 'control')
    const group: { slug: string; expose?: import('../types/assignments.js').RenderedExposure } = { slug }
    if (selected.length && assignment?.exposable && !suppressExposure(assignments)) {
      const exposure = { slug, arm: assignment.arm, phase: assignment.phase }
      if (assignment.policy === 'render' && !exposed.has(slug)) { result.rendered.push(exposure); exposed.add(slug) }
      if (assignment.policy === 'viewport') group.expose = exposure
    }
    const start = result.blocks.length
    result.blocks.push(...content.map(row => ({ ...row, xpGroup: group })))
    if (content.length) result.groups.push({ ...group, start, end: result.blocks.length })
  }
  return result
}
