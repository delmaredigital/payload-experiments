import { expect, test } from 'vitest'
import { createPgliteDb } from '../_helpers/pglite.js'

test('the generated schema supports insert-ignore deduplication in a fresh PGlite', async () => {
  const { client, close } = await createPgliteDb()
  try {
    const insert = `INSERT INTO xp_events (type, unit_id, unit_type, ts, dedupe_key)
      VALUES ('conversion', 'visitor-1', 'visitor', '2026-10-30T00:00:00Z', 'conversion:s:one')
      ON CONFLICT (dedupe_key) DO NOTHING`
    await client.exec(insert)
    await client.exec(insert)
    const { rows } = await client.query<{ count: number }>('SELECT count(*)::integer AS count FROM xp_events')
    expect(rows).toEqual([{ count: 1 }])
  } finally {
    await close()
  }
  // A new call must have its own empty schema, without the previous row.
  const fresh = await createPgliteDb()
  try {
    const { rows } = await fresh.client.query<{ count: number }>('SELECT count(*)::integer AS count FROM xp_events')
    expect(rows).toEqual([{ count: 0 }])
  } finally {
    await fresh.close()
  }
}, 60_000)
