import { afterEach, expect, test, vi } from 'vitest'
import { pageGuardBeforeChange } from '../../src/hooks/pageGuard.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { createFakeExecutor } from '../_fakes/executor.js'
import { sampleOptions } from '../collections/fixtures.js'

afterEach(() => vi.restoreAllMocks())

test('publishing a running block permits deleting leftover content but refuses deleting its last placement', async () => {
  const options = sampleOptions()
  options.puck = { enabled: true, collections: ['pages'] }
  options.pages = { collections: [{ slug: 'pages', pathOf: () => '/example', findByPath: vi.fn() }] }
  const arms = [{ key: 'control', kind: 'control', slot: 'control' }, { key: 'variantA', kind: 'variant', slot: 'variantA' }]
  const testDoc = { id: 2, kind: 'block', slug: 'hero', name: 'Hero', status: 'running', arms, phase: 1, pageCollection: null, placementDocs: null }
  const block = { type: 'ExperimentSlot', props: { id: 'hero-block', experiment: { id: 2, slug: 'hero' }, control: [{}], variantA: [{}], variantB: [{ type: 'Text', props: { id: 'leftover' } }] } }
  const published = { id: 1, _status: 'published', puckData: { root: { props: {} }, content: [block] } }
  const executor = createFakeExecutor()
  const payload = fakePayload({ executor, config: { custom: { xp: options } }, collections: { pages: [published], 'xp-experiments': [testDoc] } })
  payload.db.findOne = vi.fn(async () => published) as never
  executor.query = async <R>(text: string, params: unknown[] = []) => {
    executor.calls.push({ text, params })
    return { rows: (text.includes('LEFT JOIN LATERAL') || text.includes('ANY($1::text[])') ? [testDoc] : text.includes('current_setting') ? [{ timeout: '0' }] : []) as R[], rowCount: 1 }
  }
  const req = fakeReq({ payload })
  req.transactionID = executor.withSession({ payload }).transactionID
  const collection = { slug: 'pages', versions: { drafts: {} } }
  payload.config.collections = [collection as never]
  const save = (content: unknown[]) => pageGuardBeforeChange({ req, collection, originalDoc: published, operation: 'update', data: { _status: 'published', puckData: { ...published.puckData, content } } } as never)
  await expect(save([{ ...block, props: { ...block.props, variantB: [] } }])).resolves.toBeDefined()
  expect(payload.calls).toEqual([])
  await expect(save([])).rejects.toMatchObject({ code: 'locked-placement', status: 409 })
})
