import type { Payload, PayloadRequest } from 'payload'
import { beforeAll, afterAll, expect, test, vi } from 'vitest'
import { createPgliteDb } from '../_helpers/pglite.js'
import { pooledExecutor, type Executor } from '../../src/db/executor.js'
import { pickSlug, retireSlug, preserveRetiredSlugs } from '../../src/db/slugs.js'
import { statusPageContent } from '../../src/db/pageContent.js'
import { identicalPageVersions } from '../../src/transitions/pageVersions.js'
import { handlePlacementStatus } from '../../src/endpoints/placementStatus.js'
import { handlePages } from '../../src/endpoints/pages.js'
import { sampleOptions } from '../collections/fixtures.js'
import { fakeReq } from '../_fakes/req.js'
import { fakePayload } from '../_fakes/payload.js'

let store: Awaited<ReturnType<typeof createPgliteDb>>
let raw: Executor
beforeAll(async () => { store = await createPgliteDb(); raw = pooledExecutor({ db: { drizzle: store.db } } as unknown as Payload) }, 60_000)
afterAll(async () => { await store?.close() })
const insert = async (slug: string, content: unknown = {}) => (await raw.query<{ id: number }>(`INSERT INTO xp_experiments (slug,name,status,kind,unit_type,allocation,exposure_policy,decision_content_report,created_at,updated_at)
  VALUES ($1,$1,'draft','page','visitor',100,'pageview',$2::jsonb,now(),now()) RETURNING id`, [slug, JSON.stringify(content)])).rows[0]!.id
const execWithoutLocks: Executor = { query<R>(text: string, params?: unknown[]) {
  return text.includes('pg_advisory_xact_lock') ? Promise.resolve({ rows: [] as R[], rowCount: 1 }) : raw.query<R>(text, params)
} }

test('slug selection skips live, retired and suffix collisions, and bounds the stem', async () => {
  await insert('collide'); await insert('collide-3')
  await retireSlug(execWithoutLocks, 'collide-2')
  expect(await pickSlug(execWithoutLocks, 'collide', true)).toBe('collide-4')
  const stem = 'x'.repeat(64)
  await insert(stem)
  expect(await pickSlug(execWithoutLocks, stem, true)).toBe('x'.repeat(62) + '-2')
  const query = vi.fn(raw.query.bind(raw))
  await pickSlug({ query: query as Executor['query'] }, 'unlocked', false)
  expect(query.mock.calls.some(([text]) => text.includes('advisory'))).toBe(false)
})
test('two concurrent creates of foo and foo-2 lock every candidate before querying', async () => {
  await insert('foo')
  // PGlite is one session. Model transaction advisory locks while retaining real SQL collision checks
  // and unique-index inserts; the train covers the physical Postgres session locks.
  const held = new Map<string, Promise<void>>()
  function transactionExecutor() {
    const releases: Array<() => void> = []
    return { release: () => releases.forEach(release => release()), exec: { async query<R>(text: string, params?: unknown[]) {
      if (!text.includes('pg_advisory_xact_lock')) return raw.query<R>(text, params)
      const key = String(params![0]), previous = held.get(key)
      let release!: () => void
      const promise = new Promise<void>(resolve => { release = resolve })
      held.set(key, promise)
      if (previous) await previous
      releases.push(release)
      return { rows: [] as R[], rowCount: 1 }
    } } satisfies Executor }
  }
  async function create(stem: string) {
    const tx = transactionExecutor()
    try {
      const slug = await pickSlug(tx.exec, stem, true)
      // Give both creates a chance to pick before inserting if the candidate lock is absent.
      await new Promise(resolve => setTimeout(resolve, 10))
      await insert(slug)
      return slug
    } finally { tx.release() }
  }
  expect((await Promise.all([create('foo'), create('foo-2')])).sort()).toEqual(['foo-2', 'foo-3'])
})
test('retired slugs survive a stale whole-row global write-back', async () => {
  await retireSlug(execWithoutLocks, 'retired-writeback')
  const payload = { db: { drizzle: store.db } } as unknown as Payload
  const req = { payload } as PayloadRequest
  const data = await preserveRetiredSlugs({ req, data: { revision: 9, retiredSlugs: [] } } as never)
  await raw.query('UPDATE xp_state SET revision = $1, retired_slugs = $2::jsonb', [data.revision, JSON.stringify(data.retiredSlugs)])
  const state = await raw.query<{ retired: string[] }>('SELECT retired_slugs AS retired FROM xp_state')
  expect(state.rows[0]!.retired).toContain('retired-writeback')
})

/** Adapter-shaped document reads backed by the generated fixture's JSONB column. No host DDL. */
async function pageHarness(name: string, main: Record<string, unknown>, draft: Record<string, unknown>) {
  const id = await insert(name, { main, draft })
  async function rows() { return (await raw.query<{ content: { main: Record<string, unknown>; draft: Record<string, unknown> } }>('SELECT decision_content_report AS content FROM xp_experiments WHERE id = $1', [id])).rows[0]!.content }
  const options = { ...sampleOptions(), pages: { collections: [{ slug: 'pages', pathOf: (doc: Record<string, unknown>) => typeof doc.path === 'string' ? doc.path : null,
    findByPath: vi.fn(async () => null), contentOf: (doc: Record<string, unknown>) => doc.layout }] } }
  const payload = fakePayload({ config: { collections: [{ slug: 'pages', versions: { drafts: true }, admin: { useAsTitle: 'title' } }] } })
  const findByID = vi.fn(async ({ draft: latest }: { draft?: boolean }) => ({ id, ...(latest ? (await rows()).draft : (await rows()).main) }))
  Object.assign(payload, { findByID, findGlobal: vi.fn(async () => ({ retiredSlugs: ['deleted-test'] })) })
  Object.assign(payload.db, {
    findOne: vi.fn(async () => ({ id, ...(await rows()).main })),
    findVersions: vi.fn(async (args: { sort?: string }) => args.sort ? { docs: [{ version: (await rows()).draft }] } : { docs: [] }),
  })
  const req = fakeReq({ payload, body: JSON.stringify({ docs: [{ collection: 'pages', id }], slugs: ['deleted-test', 'never-a-test'] }) })
  return { id, req, payload, options, rows }
}
test.each([
  ['published', { path: '/published/', title: 'Published', _status: 'published' }, { path: '/draft-rename', title: 'Draft', _status: 'draft' }, '/published/'],
  ['never-published', { path: '/created', title: 'Created', _status: 'draft' }, { path: '/latest/', title: 'Latest', _status: 'draft' }, '/latest/'],
] as const)('status path for %s uses the published-else-never-published rule', async (name, main, draft, path) => {
  const f = await pageHarness(name, main, draft)
  const response = await handlePlacementStatus(f.req, { options: f.options })
  const result = await response.json()
  expect(result.docs[`pages:${f.id}`]).toEqual({ path, tests: [] })
  expect(result.slugs).toEqual({ 'deleted-test': { deleted: true }, 'never-a-test': { missing: true } })
  expect(f.payload.findByID).toHaveBeenCalledWith(expect.objectContaining({ req: f.req, overrideAccess: false, depth: 0 }))
  if (name === 'published') expect((await statusPageContent(f.req, 'pages', f.id))?.path).toBe('/published/')
})
test('picker returns raw and normalised paths, latest never-published title, and main-row search/sort', async () => {
  const f = await pageHarness('picker', { path: '/created', title: 'Created', _status: 'draft' }, { path: '/latest/', title: 'Latest', _status: 'draft' })
  const find = vi.fn(async () => ({ docs: [{ id: f.id, ...(await f.rows()).main }], hasNextPage: false }))
  Object.assign(f.payload, { find })
  const req = fakeReq({ payload: f.payload, url: 'https://example.test/api/xp/pages?collection=pages' })
  const response = await handlePages(req, { options: f.options })
  expect(await response.json()).toEqual({ docs: [{ id: f.id, title: 'Latest', path: '/latest/', pathKey: '/latest', published: false }], hasNextPage: false })
  expect(find).toHaveBeenCalledWith(expect.objectContaining({ sort: '-createdAt', draft: false, depth: 0, req, overrideAccess: false, limit: 20 }))
})
test('identical published versions compare content with fresh ids and blockName removed', async () => {
  const f = await pageHarness('identical', { layout: [{ id: 'original-row', blockName: 'Editor label', text: 'Same' }], _status: 'published' }, {})
  const version = await insert('identical-version', { main: { layout: [{ id: 'fresh-row', blockName: 'Copied label', text: 'Same' }], _status: 'published' } })
  Object.assign(f.payload.db, { findOne: vi.fn(async ({ where }: { where: { id: { equals: number } } }) => {
    const result = await raw.query<{ content: { main: Record<string, unknown> } }>('SELECT decision_content_report AS content FROM xp_experiments WHERE id = $1', [where.id.equals])
    return { id: where.id.equals, ...result.rows[0]!.content.main }
  }) })
  const registration = { ...f.options.pages.collections[0]!, findByPath: vi.fn(async (path: string) => ({ id: path === '/original' ? f.id : version, published: true })) }
  const arms = [{ key: 'control', kind: 'control', label: 'Original', weight: 50, pageTarget: '/original' }, { key: 'variantA', kind: 'variant', label: 'Variant A', weight: 50, pageTarget: '/version' }] as const
  expect(await identicalPageVersions(f.req, registration, [...arms])).toEqual([{ arm: 'variantA', path: '/version', collection: 'pages', id: version }])
  expect(await identicalPageVersions(f.req, { ...registration, contentOf: undefined }, [...arms])).toEqual([])
})

test.each([true, false])('slug-pick hook uses transaction locks only with a transaction (%s)', async transactional => {
  const { pickExperimentSlug } = await import('../../src/collections/experiments/pickSlug.js')
  const calls: string[] = []
  const db = { execute: vi.fn(async (sql: unknown) => {
    const { PgDialect } = await import('drizzle-orm/pg-core')
    const query = new PgDialect().sqlToQuery(sql as never)
    calls.push(query.sql)
    if (query.sql.includes('advisory')) return { rows: [], rowCount: 1 }
    return { rows: [{ used: query.params[0] === 'hook-slug' }], rowCount: 1 }
  }) }
  const req = { payload: { db: { drizzle: db, sessions: { tx: { db } } } }, ...(transactional ? { transactionID: 'tx' } : {}) } as unknown as PayloadRequest
  const result = await pickExperimentSlug({ req, operation: 'create', data: { slug: 'hook-slug' } } as never)
  expect(result.slug).toBe('hook-slug-2')
  expect(calls.filter(sql => sql.includes('advisory'))).toHaveLength(transactional ? 2 : 0)
})
