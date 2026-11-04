import type { Payload } from 'payload'
import { expect, test } from 'vitest'
import { insertIdentity } from '../../src/db/identities.js'
import { identityRows } from '../../src/db/results.js'
import { pooledExecutor } from '../../src/db/executor.js'
import { createPgliteDb } from '../_helpers/pglite.js'

test('insert/upgrade outcomes: first link wins, timestamps persist, ownership includes unexposed browsers', async () => {
  const database = await createPgliteDb()
  try {
    const exec = pooledExecutor({ db: { drizzle: database.db } } as unknown as Payload)
    expect(await insertIdentity(exec, { anonymousId: 'A', userId: 'owner', verified: false })).toBe('linked')
    expect(await insertIdentity(exec, { anonymousId: 'A', userId: 'owner', verified: false })).toBe('skipped')
    expect(await identityRows(exec, { anonymousIds: ['A'] })).toEqual([{ anonymousId: 'A', userId: 'owner', verifiedAt: null, ownedAt: null }])
    expect(await insertIdentity(exec, { anonymousId: 'A', userId: 'attacker', verified: true })).toBe('skipped')
    expect(await insertIdentity(exec, { anonymousId: 'B', userId: 'owner', verified: true })).toBe('linked')
    const [b] = await identityRows(exec, { anonymousIds: ['B'] })
    const [a] = await identityRows(exec, { anonymousIds: ['A'] })
    expect(a).toEqual({ anonymousId: 'A', userId: 'owner', verifiedAt: null, ownedAt: b!.verifiedAt })
    const before = (await exec.query('SELECT linked_at, created_at FROM xp_identities WHERE anonymous_id = $1', ['A'])).rows
    expect(await insertIdentity(exec, { anonymousId: 'A', userId: 'owner', verified: true })).toBe('verified')
    const upgraded = await identityRows(exec, { anonymousIds: ['A'] })
    expect(upgraded[0]!.verifiedAt).toEqual(expect.any(Number))
    expect((await exec.query('SELECT linked_at, created_at FROM xp_identities WHERE anonymous_id = $1', ['A'])).rows).toEqual(before)
    expect(await insertIdentity(exec, { anonymousId: 'A', userId: 'owner', verified: true })).toBe('skipped')
    expect(await insertIdentity(exec, { anonymousId: 'A', userId: 'owner', verified: false })).toBe('skipped')
    expect(await insertIdentity(exec, { anonymousId: 'A', userId: 'other', verified: true })).toBe('skipped')
    expect(await insertIdentity(exec, { anonymousId: 'A', userId: 'other', verified: false })).toBe('skipped')
    expect(await identityRows(exec, { anonymousIds: ['A'] })).toEqual(upgraded)
  } finally { await database.close() }
}, 60_000)
