import { Locked, type PayloadRequest } from 'payload'
import { wrapExperimentBlock } from '../blocks/formState.js'
import { EXPERIMENT_BLOCK_SLUG, hostBlocks, isObject } from '../blocks/model.js'
import { XpRefusal } from '../errors.js'
import type { EndpointContext } from '../types/endpoints.js'
import type { DocId } from '../types/contracts.js'

export async function handleWrapBlock<TUser extends { id: DocId }>(req: PayloadRequest, { options }: EndpointContext<TUser>): Promise<Response> {
  let value: unknown
  try { value = req.data ?? await req.json?.() } catch { throw new XpRefusal('invalid-body', 'Enter a valid request body.', undefined, 422) }
  if (!isObject(value) || Object.keys(value).some(k => !['collection', 'id', 'field', 'blockId', 'experiment'].includes(k))
    || !['collection', 'field', 'blockId', 'experiment'].every(k => typeof value[k] === 'string' && (value[k] as string).trim())
    || !(typeof value.id === 'string' && value.id.trim() || typeof value.id === 'number' && Number.isSafeInteger(value.id))) throw new XpRefusal('invalid-body', 'Enter a valid request body.', undefined, 422)
  const { collection, field, blockId, experiment } = value as Record<'collection' | 'field' | 'blockId' | 'experiment', string>
  const id = value.id as DocId
  const registration = options.blocks?.collections.find(r => r.slug === collection && r.field === field)
  if (!registration) throw new XpRefusal('unknown-collection', "That page type isn't set up for tests.", undefined, 422)
  const tests = await req.payload.find({ collection: 'xp-experiments', req, overrideAccess: false, depth: 0, limit: 1, where: { slug: { equals: experiment } } })
  const test = tests.docs[0]
  if (test?.kind !== 'block') throw new XpRefusal('invalid-body', 'Choose a block test.', undefined, 422)
  if (test.status !== 'draft') throw new XpRefusal('invalid-status', 'This action is not available in the current status.', undefined, 409)
  const doc = await req.payload.findByID({ collection, id, req, overrideAccess: false, depth: 0, draft: true, includeLockStatus: true })
  const blocks = hostBlocks(doc[field]), blockSlug = registration.blockSlug ?? EXPERIMENT_BLOCK_SLUG
  const index = blocks.findIndex(block => block.id === blockId && block.blockType !== blockSlug)
  if (index < 0) throw new XpRefusal('wrap-target-missing', 'Reload the page and try again.', undefined, 409)
  blocks[index] = wrapExperimentBlock(blocks[index]!, experiment, blockSlug)
  try {
    const result = await req.payload.update({ collection, id, req, overrideAccess: false, overrideLock: false, draft: true, data: { [field]: blocks } })
    return Response.json(result)
  } catch (error) {
    if (error instanceof Locked || error instanceof Error && error.name === 'Locked') throw new XpRefusal('locked-placement', 'Another editor has this page open. Try again when it is unlocked.', undefined, 409)
    throw error
  }
}
