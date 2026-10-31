import { createLocalReq } from 'payload'
import { expect, test } from 'vitest'
import { buildAndStoreManifest } from '../src/manifest/compile.js'
import { createPostgresManifestLoader } from '../src/runtime/loaders.js'
import { createIntegrationHarness } from './harness.js'

// Train-only: a real Payload transaction, generated schema, and host pg pool.
test('Postgres loader equals builder and observes the next committed revision', async () => {
  const harness = await createIntegrationHarness()
  try {
    const { payload, pool, schemaName } = harness
    const req = await createLocalReq({ context: { xpTransition: true } }, payload)
    const seed = '0123456789abcdef0123456789abcdef|'
    const arms = [
      { key: 'control', kind: 'control', label: 'Original', slot: 'control', weight: 50 },
      { key: 'variantA', kind: 'variant', label: 'Variant A', slot: 'variantA', weight: 50 },
    ]
    const experiment = await payload.create({ collection: 'xp-experiments', overrideAccess: true, req, data: {
      name: 'Manifest loader integration', slug: 'manifest-loader', kind: 'block', status: 'running', unitType: 'visitor',
      exposurePolicy: 'render', phase: 1, seed, allocation: 50, arms,
    } })
    await payload.create({ collection: 'xp-phases', overrideAccess: true, req, data: {
      experiment: experiment.id, phase: 1, phaseKind: 'test', startedAt: new Date().toISOString(), seed, arms, allocation: 50, targeting: [],
    } })
    async function build() {
      const transactionID = await payload.db.beginTransaction()
      if (transactionID == null) throw new Error('Integration requires transactions')
      req.transactionID = transactionID
      try {
        const manifest = await buildAndStoreManifest(req)
        await payload.db.commitTransaction(transactionID)
        return manifest
      } catch (error) {
        await payload.db.rollbackTransaction(transactionID)
        throw error
      } finally { req.transactionID = undefined }
    }
    const first = await build()
    expect(first.experiments).toHaveLength(1)
    expect(first.experiments[0]).toMatchObject({ slug: 'manifest-loader', coverage: 0.5, phase: 1, seed })
    const load = createPostgresManifestLoader({ pool, schemaName })
    expect(await load()).toEqual(first)
    expect(await load({ ifRevision: first.revision })).toBe('not-modified')
    const second = await build()
    expect(second.revision).toBe(first.revision + 1)
    expect(await load({ ifRevision: first.revision })).toEqual(second)
  } finally { await harness.teardown() }
})
