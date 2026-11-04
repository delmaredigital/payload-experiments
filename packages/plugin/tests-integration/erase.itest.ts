import { expect, test } from 'vitest'
import { pooledExecutor } from '../src/db/executor.js'
import { insertEvents, type EventRow } from '../src/db/events.js'
import { insertIdentity } from '../src/db/identities.js'
import { eraseUser } from '../src/server/eraseUser.js'
import { createIntegrationHarness } from './harness.js'

test('eraseUser deletes direct attribution, user units, linked visitors and identities', async () => {
  const harness = await createIntegrationHarness()
  try {
    const exec = pooledExecutor(harness.payload)
    await insertIdentity(exec, { verified: false, anonymousId: 'linked', userId: 'user' })
    await insertIdentity(exec, { verified: false, anonymousId: 'other-linked', userId: 'other' })
    const row: EventRow = { type: 'conversion', unitType: 'visitor', unitId: 'visitor', userId: 'user', dedupeKey: 'direct', ts: new Date().toISOString() }
    await insertEvents(exec, [row, { ...row, userId: undefined, unitId: 'user', unitType: 'user', dedupeKey: 'user-unit' },
      { ...row, userId: undefined, unitId: 'linked', dedupeKey: 'linked' }, { ...row, userId: 'other', unitId: 'other-linked', dedupeKey: 'other' }])
    expect(await eraseUser(harness.payload, { userId: 'user' })).toEqual({ identities: 1, events: 3 })
    expect(await eraseUser(harness.payload, { userId: 'user' })).toEqual({ identities: 0, events: 0 })
    expect((await exec.query('SELECT dedupe_key FROM "' + harness.schemaName + '".xp_events')).rows).toEqual([{ dedupe_key: 'other' }])
    expect((await exec.query('SELECT user_id FROM "' + harness.schemaName + '".xp_identities')).rows).toEqual([{ user_id: 'other' }])
  } finally { await harness.teardown() }
})
