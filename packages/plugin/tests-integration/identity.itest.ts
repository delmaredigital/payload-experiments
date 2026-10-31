import { expect, test } from 'vitest'
import { pooledExecutor } from '../src/db/executor.js'
import { linkIdentity } from '../src/server/linkIdentity.js'
import { encodeUnitCookie } from '../src/runtime/cookie.js'
import { defineExperimentsProxyRuntime } from '../src/runtime/proxyRuntime.js'
import { defineExperimentsServerRuntime } from '../src/server/serverRuntime.js'
import { createIntegrationHarness } from './harness.js'

test('double sign-in creates one identity outside the caller transaction', async () => {
  const harness = await createIntegrationHarness()
  try {
    const runtime = defineExperimentsServerRuntime(defineExperimentsProxyRuntime({ secret: 'test-secret', apiRoute: '/api/xp' }), { getPayload: async () => harness.payload })
    const opts = { userId: 'user', headers: new Headers({ cookie: `xp_id=${encodeUnitCookie('visitor', ['test-secret'])}` }) }
    const transactionID = await harness.payload.db.beginTransaction()
    if (transactionID == null) throw new Error('Transactions required')
    try { await Promise.all([linkIdentity(runtime, opts), linkIdentity(runtime, opts)]) }
    finally { await harness.payload.db.rollbackTransaction(transactionID) }
    const exec = pooledExecutor(harness.payload)
    expect((await exec.query('SELECT anonymous_id, user_id FROM "' + harness.schemaName + '".xp_identities')).rows).toEqual([{ anonymous_id: 'visitor', user_id: 'user' }])
  } finally { await harness.teardown() }
})
