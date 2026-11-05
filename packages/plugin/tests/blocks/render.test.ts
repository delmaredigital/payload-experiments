import { expect, test, vi } from 'vitest'
import { controlOnlyBlocks, segmentExperimentBlocks } from '../../src/exports/blocks.js'
import { resolveExperimentBlocks } from '../../src/server/resolveExperimentBlocks.js'
import { recordExposures } from '../../src/server/recordExposures.js'
import type { Payload } from 'payload'
import type { ExperimentsServerRuntime } from '../../src/types/runtime.js'
import type { Assignments } from '../../src/types/assignments.js'
const block = { blockType: 'xpExperiment', experiment: 'hero', slots: [
  { slot: 'control', blocks: [{ id: 'original-id', blockType: 'text', text: 'Original' }] },
  { slot: 'variantA', blocks: [{ id: 'winner-id', blockType: 'text', text: 'Winner' }] },
] }
function assignments(arm = 'variantA', policy = 'render'): Assignments {
  return { bySlug: { hero: { slug: 'hero', experimentId: 1, arm, phase: 2, exposable: true, policy, source: 'header' } },
    archivedWinners: {}, revision: 1, flagPoints: {}, staff: false, bot: false, preview: false, sessionUnknown: false, method: 'GET' } as Assignments
}
test('variant blocks retain ids; only rendered content exposes once per test per page', () => {
  const result = resolveExperimentBlocks([block, block], assignments())
  expect(result.blocks.map(row => row.id)).toEqual(['winner-id', 'winner-id'])
  expect(result.rendered).toEqual([{ slug: 'hero', arm: 'variantA', phase: 2 }])
  expect(result.groups).toEqual([{ slug: 'hero', start: 0, end: 1 }, { slug: 'hero', start: 1, end: 2 }])
})
test('holdout renders Original and exposes the assigned holdout arm', () => {
  const result = resolveExperimentBlocks([block], assignments('holdout'))
  expect(result.blocks[0]).toMatchObject({ id: 'original-id', text: 'Original' })
  expect(result.rendered).toEqual([{ slug: 'hero', arm: 'holdout', phase: 2 }])
})
test('viewport exposes the group, never the rendered list', () => {
  const result = resolveExperimentBlocks([block], assignments('variantA', 'viewport'))
  expect(result.rendered).toEqual([])
  expect(result.groups[0]?.expose).toEqual({ slug: 'hero', arm: 'variantA', phase: 2 })
  expect(segmentExperimentBlocks(result.blocks)[0]?.group?.expose).toEqual(result.groups[0]?.expose)
})
test.each(['bot', 'staff', 'preview', 'HEAD', 'consent'])('%s cannot expose', reason => {
  const a = assignments()
  if (reason === 'HEAD') a.method = 'HEAD'
  else if (reason === 'consent') a.bySlug.hero!.exposable = false
  else a[reason as 'bot' | 'staff' | 'preview'] = true
  expect(resolveExperimentBlocks([block], a).rendered).toEqual([])
})
test('absent, archived, missing and empty rows are safe; first duplicate slot wins; nesting is not read', () => {
  const a = assignments(); delete a.bySlug.hero
  expect(resolveExperimentBlocks([block], a).blocks[0]?.id).toBe('original-id')
  a.archivedWinners.hero = 'variantA'
  expect(resolveExperimentBlocks([block], a).blocks[0]?.id).toBe('winner-id')
  const empty = { ...block, slots: [block.slots[0], { slot: 'variantA', blocks: [] }] }
  expect(resolveExperimentBlocks([empty], assignments())).toMatchObject({ rendered: [], blocks: [{ id: 'original-id' }] })
  const duplicate = { ...block, slots: [block.slots[0], block.slots[1], { slot: 'variantA', blocks: [{ id: 'second', blockType: 'text' }] }] }
  expect(resolveExperimentBlocks([duplicate], assignments()).blocks[0]?.id).toBe('winner-id')
  const outer = { id: 'outer', blockType: 'group', blocks: [block] }
  expect(resolveExperimentBlocks([outer], assignments()).blocks[0]).toEqual(outer)
  expect(resolveExperimentBlocks([null, {}, { blockType: 'xpExperiment', slots: null }], assignments())).toEqual({ blocks: [], rendered: [], groups: [] })
  expect(controlOnlyBlocks([block])[0]?.id).toBe('original-id')
})
test('segmentation keeps ordinary runs separate from distinct placements', () => {
  const result = resolveExperimentBlocks([{ blockType: 'text' }, block, { blockType: 'text' }, { blockType: 'text' }], assignments())
  expect(segmentExperimentBlocks(result.blocks).map(run => run.blocks.length)).toEqual([1, 1, 2])
})

test('host render contract records only resolved content, including the holdout assigned arm', async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [{ revision: 1, manifest: { experiments: [{ id: 1, slug: 'hero', unitType: 'visitor' }] } }] })
  const runtime = { getPayload: async () => ({ db: { drizzle: { execute } }, logger: { error: vi.fn() } } as unknown as Payload) } as ExperimentsServerRuntime
  const a = assignments('holdout'); a.visitorId = 'visitor'
  const resolved = resolveExperimentBlocks([block], a)
  await recordExposures(runtime, resolved.rendered, a)
  expect(JSON.stringify(execute.mock.calls.at(-1))).toContain('exposure:1:2:holdout:visitor')
  execute.mockClear()
  const missing = resolveExperimentBlocks([{ ...block, slots: [{ slot: 'control', blocks: [] }] }], a)
  await recordExposures(runtime, missing.rendered, a)
  expect(execute).not.toHaveBeenCalled()
})
