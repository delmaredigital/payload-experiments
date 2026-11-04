import type { PayloadRequest } from 'payload'
import type { Arm, DocId, ExperimentKind, Status } from '../types/contracts.js'
import type { EndpointContext, PlacementStatusBody, PlacementStatusResult } from '../types/endpoints.js'
import { statusPageContent } from '../db/pageContent.js'
import { normalisePath } from '../runtime/normalisePath.js'
import { puckCollections } from '../options.js'
import { resolvePageCollection } from '../transitions/pageCollection.js'

const error = (status: number, code: string, message: string) => Response.json({ errors: [{ code, message }] }, { status })
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const id = (v: unknown): v is DocId => typeof v === 'string' && !!v.trim() || typeof v === 'number' && Number.isSafeInteger(v)

async function readBody(req: PayloadRequest): Promise<unknown> {
  if (req.data !== undefined) {
    if (Buffer.byteLength(JSON.stringify(req.data)) > 16 * 1024) throw new RangeError()
    return req.data
  }
  if (!req.body) return {}
  const reader = req.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 16 * 1024) { void reader.cancel().catch(() => {}); throw new RangeError() }
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally { reader.releaseLock() }
}

type Test = { id: DocId; slug: string; name: string; kind: ExperimentKind; status: Status; pageCollection?: string; arms: Arm[];
  decision?: { winnerArm?: string; discardedAt?: string; pagesReleasedAt?: string; holdoutReleasedAt?: string } }

export async function handlePlacementStatus<TUser extends { id: DocId }>(req: PayloadRequest, { options }: EndpointContext<TUser>): Promise<Response> {
  let value: unknown
  try { value = await readBody(req) } catch (cause) { return error(cause instanceof RangeError ? 413 : 422, cause instanceof RangeError ? 'body-too-large' : 'invalid-body', 'Enter a valid request body.') }
  if (!object(value) || Object.keys(value).some(key => key !== 'docs' && key !== 'slugs')
    || value.docs !== undefined && !Array.isArray(value.docs) || value.slugs !== undefined && !Array.isArray(value.slugs)) return error(422, 'invalid-body', 'Enter a valid request body.')
  if (((value.docs as unknown[] | undefined)?.length ?? 0) > 100 || ((value.slugs as unknown[] | undefined)?.length ?? 0) > 100) return error(422, 'too-many-ids', 'Choose at most 100 documents and slugs.')
  if ((value.docs as unknown[] | undefined)?.some(doc => !object(doc) || typeof doc.collection !== 'string' || !id(doc.id))
    || (value.slugs as unknown[] | undefined)?.some(slug => typeof slug !== 'string' || !slug || slug.length > 64)) return error(422, 'invalid-body', 'Enter valid documents and slugs.')
  const body = value as PlacementStatusBody
  const registered = new Set([...options.pages?.collections.map(entry => entry.slug) ?? [], ...options.blocks?.collections.map(entry => entry.slug) ?? [], ...puckCollections(options).map(entry => entry.slug)])
  if (body.docs?.some(doc => !registered.has(doc.collection))) return error(422, 'unknown-collection', "That page type isn't set up for tests.")
  const result: PlacementStatusResult = { docs: Object.create(null), slugs: Object.create(null) }
  const wanted = body.slugs ?? []
  const { docs } = await req.payload.find({ collection: 'xp-experiments', req, overrideAccess: false, depth: 0, pagination: false, limit: 0,
    where: !body.docs?.length ? { slug: { in: wanted } } : undefined })
  const tests = docs as unknown as Test[]
  const state = wanted.length ? await req.payload.findGlobal({ slug: 'xp-state', req, overrideAccess: false, depth: 0 }) : null
  const retired = Array.isArray(state?.retiredSlugs) ? state.retiredSlugs : []
  const rounds = new Map<string, { arms: Arm[]; rollout: boolean }>()
  for (const test of tests) {
    let arms = test.arms, rollout = false
    if (['running', 'decided', 'archived'].includes(test.status)) {
      const phases = await req.payload.find({ collection: 'xp-phases', req, overrideAccess: false, depth: 0, limit: 1, sort: '-phase', where: { experiment: { equals: test.id } } })
      const latest = phases.docs[0]
      rollout = test.status === 'decided' && latest?.phaseKind === 'rollout' && !latest.endedAt && !test.decision?.holdoutReleasedAt
      if (latest?.phaseKind === 'test') arms = latest.arms as Arm[]
      else if (latest) {
        const frozen = await req.payload.find({ collection: 'xp-phases', req, overrideAccess: false, depth: 0, limit: 1, sort: '-phase', where: { and: [{ experiment: { equals: test.id } }, { phaseKind: { equals: 'test' } }] } })
        arms = frozen.docs[0]?.arms as Arm[] ?? arms
      }
    }
    rounds.set(test.slug, { arms, rollout })
  }
  for (const slug of wanted) {
    const test = tests.find(test => test.slug === slug)
    if (!test) { result.slugs[slug] = retired.includes(slug) ? { deleted: true } : { missing: true }; continue }
    const round = rounds.get(slug)!
    result.slugs[slug] = { name: test.name, status: test.status, kind: test.kind,
      arms: round.arms.map(({ key, label, slot }) => ({ key, label, ...(slot ? { slot } : {}) })),
      ...(test.decision?.winnerArm ? { winnerArm: test.decision.winnerArm } : {}), rollout: round.rollout }
  }
  for (const { collection, id } of body.docs ?? []) {
    // Check document access before the raw path read. A refused read propagates.
    await req.payload.findByID({ collection, id, req, overrideAccess: false, depth: 0, draft: false })
    const registration = options.pages?.collections.find(entry => entry.slug === collection)
    const raw = registration ? await statusPageContent(req, collection, id) : null
    const rawPath = raw && registration ? registration.pathOf(raw) : null
    const path = rawPath
    const pathKey = path === null ? null : normalisePath(path)
    const status: PlacementStatusResult['docs'][string] = { path, tests: [] }
    for (const test of tests) {
      if (test.kind !== 'page' || path === null || test.decision?.pagesReleasedAt || test.decision?.discardedAt) continue
      const round = rounds.get(test.slug)!
      const testCollection = await resolvePageCollection(req, options, { ...test, arms: round.arms })
      if (testCollection?.slug !== collection) continue
      const arm = round.arms.find(arm => arm.kind !== 'holdout' && arm.pageTarget && normalisePath(arm.pageTarget) === pathKey)
      if (!arm) continue
      const winner = round.arms.find(arm => arm.key === test.decision?.winnerArm)
      const original = round.arms.find(arm => arm.kind === 'control')
      const winnerPage = winner?.pageTarget && registration ? await registration.findByPath(winner.pageTarget, req) : null
      const winnerDoc = winnerPage ? await req.payload.findByID({ collection, id: winnerPage.id, req, overrideAccess: false, depth: 0, draft: false }) : null
      const titleField = req.payload.config.collections.find(entry => entry.slug === collection)?.admin.useAsTitle ?? 'title'
      status.tests.push({ slug: test.slug, name: test.name, status: test.status, role: arm.kind === 'control' ? 'original' : 'version',
        armLabel: arm.label, winner: ['decided', 'archived'].includes(test.status) && winner?.key === arm.key,
        ...(winner ? { winnerLabel: winner.label, winnerPath: winner.pageTarget } : {}), ...(winnerDoc ? { winnerTitle: String(winnerDoc[titleField] ?? winnerDoc.id) } : {}),
        ...(original?.pageTarget ? { originalPath: normalisePath(original.pageTarget) } : {}), rollout: round.rollout, pagesReleased: false })
    }
    result.docs[`${collection}:${id}`] = status
  }
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
