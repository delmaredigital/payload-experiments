import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { expect, test } from 'vitest'
import { createIntegrationHarness, integrationConnectionString, publicTables } from './harness.js'

test('pushes isolated plugin tables, accepts a raw event, and removes only its schema', async () => {
  const harness = await createIntegrationHarness()
  const verifier = new Pool({ connectionString: integrationConnectionString(), max: 1 })
  try {
    const { pool, schemaName } = harness
    const columns = ['type', 'unit_id', 'unit_type', 'ts', 'dedupe_key']
    const values: unknown[] = ['conversion', 'smoke-visitor', 'visitor', new Date(), 'smoke-event']
    if (process.env.XP_IT_ID_TYPE === 'uuid') {
      columns.unshift('id')
      values.unshift(randomUUID())
    }
    await pool.query(`INSERT INTO "${schemaName}".xp_events (${columns.join(', ')}) VALUES (${values.map((_, index) => `$${index + 1}`).join(', ')})`, values)
    const count = await pool.query<{ count: string }>(`SELECT count(*) FROM "${schemaName}".xp_events`)
    expect(Number(count.rows[0]?.count)).toBe(1)
    expect(await publicTables(pool)).toEqual(harness.publicBefore)
    await harness.teardown()
    const schemas = await verifier.query('SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = $1', [schemaName])
    expect(schemas.rows).toEqual([])
    expect(await publicTables(verifier)).toEqual(harness.publicBefore)
  } finally {
    try { await harness.teardown() } finally { await verifier.end() }
  }
})
