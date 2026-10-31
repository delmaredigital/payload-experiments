import { createLocalReq } from 'payload'
import { expect, test, vi } from 'vitest'
import { txExecutor } from '../src/db/executor.js'
import { buildAndStoreManifest } from '../src/manifest/compile.js'
import { createPostgresManifestLoader } from '../src/runtime/loaders.js'
import { createIntegrationHarness } from './harness.js'

// Train-only: two real connections, READ COMMITTED, and the actual state lock.
test('concurrent manifest builds retain both committed status changes', async () => {
  const harness = await createIntegrationHarness()
  const { payload, pool, schemaName } = harness
  const firstReq = await createLocalReq({ context: { xpTransition: true } }, payload)
  const secondReq = await createLocalReq({ context: { xpTransition: true } }, payload)
  let releaseRead!: () => void
  const continueFirst = new Promise<void>(resolve => { releaseRead = resolve })
  let firstRead!: () => void
  const didRead = new Promise<void>(resolve => { firstRead = resolve })
  let firstBuild: ReturnType<typeof buildAndStoreManifest> | undefined
  let secondBuild: ReturnType<typeof buildAndStoreManifest> | undefined
  let restoreFind: (() => void) | undefined
  try {
    const setupReq = await createLocalReq({ context: { xpTransition: true } }, payload)
    const arms = [
      { key: 'control', kind: 'control', label: 'Original', slot: 'control', weight: 50 },
      { key: 'variantA', kind: 'variant', label: 'Variant A', slot: 'variantA', weight: 50 },
    ]
    const ids = []
    for (const slug of ['concurrent-a', 'concurrent-b']) {
      const seed = '0123456789abcdef0123456789abcdef|'
      const experiment = await payload.create({ collection: 'xp-experiments', overrideAccess: true, req: setupReq, data: {
        name: slug, slug, kind: 'block', status: 'running', unitType: 'visitor', exposurePolicy: 'render', phase: 1, seed, allocation: 100, arms,
      } })
      ids.push(experiment.id)
      await payload.create({ collection: 'xp-phases', overrideAccess: true, req: setupReq, data: {
        experiment: experiment.id, phase: 1, phaseKind: 'test', startedAt: new Date().toISOString(), seed, arms, allocation: 100, targeting: [],
      } })
    }
    const firstID = await payload.db.beginTransaction()
    if (firstID == null) throw new Error('Integration requires transactions')
    firstReq.transactionID = firstID
    const secondID = await payload.db.beginTransaction()
    if (secondID == null) throw new Error('Integration requires transactions')
    secondReq.transactionID = secondID
    const pid = (await txExecutor(secondReq).query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid
    await payload.update({ collection: 'xp-experiments', id: ids[0]!, req: firstReq, overrideAccess: true, data: { status: 'stopped' } })

    const originalFind = payload.find.bind(payload)
    const find = vi.spyOn(payload, 'find').mockImplementation((async args => {
      const result = await originalFind(args)
      if (args.req === firstReq && args.collection === 'xp-experiments') {
        firstRead()
        await continueFirst
      }
      return result
    }) as typeof payload.find)
    restoreFind = () => find.mockRestore()
    firstBuild = buildAndStoreManifest(firstReq).then(async manifest => {
      await payload.db.commitTransaction(firstID)
      firstReq.transactionID = undefined
      return manifest
    })
    await Promise.race([didRead, firstBuild.then(() => { throw new Error('First builder did not reach the read barrier') })])

    // B changes after the first builder has already read A/B. The second build
    // must wait for the state lock, then read A's now-committed stopped status.
    await payload.update({ collection: 'xp-experiments', id: ids[1]!, req: secondReq, overrideAccess: true, data: { status: 'stopped' } })
    secondBuild = buildAndStoreManifest(secondReq).then(async manifest => {
      await payload.db.commitTransaction(secondID)
      secondReq.transactionID = undefined
      return manifest
    })
    let secondFinished = false
    void secondBuild.then(() => { secondFinished = true }, () => { secondFinished = true })
    const deadline = Date.now() + 5_000
    while (!secondFinished) {
      const result = await pool.query<{ waiting: boolean }>("SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid = $1 AND locktype = 'advisory' AND NOT granted) AS waiting", [pid])
      if (result.rows[0]!.waiting) break
      if (Date.now() >= deadline) throw new Error('Second builder neither waited for the state lock nor completed')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    releaseRead()
    const built = await Promise.all([firstBuild, secondBuild])
    const manifest = await createPostgresManifestLoader({ pool, schemaName })()
    expect(manifest).toEqual({ ...built[1], experiments: [] })
    expect(built[1].revision).toBe(built[0].revision + 1)
  } finally {
    releaseRead()
    restoreFind?.()
    // Roll back failed work first, releasing locks before waiting for its peer.
    await Promise.all([firstReq, secondReq].map(async req => {
      const id = await req.transactionID
      if (id != null) await payload.db.rollbackTransaction(id)
      req.transactionID = undefined
    }))
    await Promise.allSettled([firstBuild, secondBuild])
    await harness.teardown()
  }
})
