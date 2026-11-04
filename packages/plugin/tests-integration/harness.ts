import { randomBytes } from 'node:crypto'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { BasePayload, buildConfig, type CollectionConfig } from 'payload'
import pg, { Pool, type PoolClient, type PoolConfig } from 'pg'
import { createExperimentsPlugin } from '../src/plugin.js'
import { sampleOptions } from '../tests/collections/fixtures.js'
import type { ExperimentsAccess, ExperimentsPluginOptions } from '../src/types/contracts.js'

/** Pure URL refusal rules; validate before opening any connection. */
export function validateIntegrationConnectionString(connectionString: string | undefined, hostDatabases: { DATABASE_URL?: string; CC_NXT_DATABASE_URL?: string } = {}): string {
  if (!connectionString) throw new Error('INTEGRATION_DATABASE_URL is required')
  if (connectionString === hostDatabases.DATABASE_URL || connectionString === hostDatabases.CC_NXT_DATABASE_URL) {
    throw new Error('Integration database must differ from host databases')
  }
  let database: string
  try {
    const url = new URL(connectionString)
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error()
    database = decodeURIComponent(url.pathname.slice(1))
  } catch {
    throw new Error('Invalid integration database URL')
  }
  if (!/(test|xp_it)/.test(database)) throw new Error('Integration database name must contain test or xp_it')
  return connectionString
}

/** Never fall back to a host database. */
export function integrationConnectionString(): string {
  return validateIntegrationConnectionString(process.env.INTEGRATION_DATABASE_URL, {
    DATABASE_URL: process.env.DATABASE_URL, CC_NXT_DATABASE_URL: process.env.CC_NXT_DATABASE_URL,
  })
}

export async function publicTables(pool: Pool): Promise<string[]> {
  const result = await pool.query<{ tablename: string }>('SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = $1 ORDER BY tablename', ['public'])
  return result.rows.map(row => row.tablename)
}

/** One harness per test file. Forced push also supports a second boot. Train-only. */
export async function createIntegrationHarness({ collections = [], puckCollections = [], manage, pages, attributeKeys }: { collections?: CollectionConfig[]; puckCollections?: Array<string | { slug: string; field?: string }>; manage?: ExperimentsAccess; pages?: ExperimentsPluginOptions['pages']; attributeKeys?: ExperimentsPluginOptions['attributeKeys'] } = {}) {
  const connectionString = integrationConnectionString()
  const pool = new Pool({ connectionString, max: 6 })
  const schemaName = `xp_it_${randomBytes(12).toString('hex')}`
  const schema = `"${schemaName}"`
  const adapterPools: Pool[] = []
  const adapterClients = new Set<PoolClient>()
  // 3.90.2 retains one checked-out client; its destroy() only clears metadata.
  // Use the adapter's supported pg injection to track clients without pool internals.
  class AdapterPool extends Pool {
    constructor(config?: PoolConfig) {
      super(config)
      adapterPools.push(this)
      this.on('acquire', client => adapterClients.add(client))
      this.on('release', (_error, client) => adapterClients.delete(client))
      this.on('remove', client => adapterClients.delete(client))
    }
  }
  let payload: BasePayload | undefined
  let schemaCreated = false
  let tornDown = false
  async function destroyPayload() {
    try {
      await payload?.destroy()
    } finally {
      for (const client of [...adapterClients]) client.release(true)
      await Promise.all(adapterPools.map(adapterPool => adapterPool.end()))
    }
  }
  try {
    const publicBefore = await publicTables(pool)
    if (publicBefore.some(name => /^(xp_|payload_)/.test(name))) throw new Error('Integration preflight refused plugin or Payload tables in public')
    await pool.query(`CREATE SCHEMA ${schema}`)
    schemaCreated = true
    Object.assign(process.env, { NODE_ENV: 'test', PAYLOAD_FORCE_DRIZZLE_PUSH: 'true' })
    delete process.env.PAYLOAD_MIGRATING
    delete process.env.PAYLOAD_DROP_DATABASE
    const options = sampleOptions()
    if (manage) options.access.manage = manage
    if (pages) options.pages = pages
    if (attributeKeys) options.attributeKeys = { ...options.attributeKeys, ...attributeKeys }
    if (puckCollections.length) options.puck = { enabled: true, collections: puckCollections }
    const config = buildConfig({
      secret: 'integration-only-secret-never-use-in-production',
      db: postgresAdapter({
        pool: { connectionString, max: 6 }, schemaName, push: true,
        pg: { ...pg, Pool: AdapterPool },
        idType: process.env.XP_IT_ID_TYPE === 'uuid' ? 'uuid' : 'serial',
      }),
      collections: [{ slug: 'users', auth: true, fields: [] }, ...collections],
      plugins: [createExperimentsPlugin(options)],
      typescript: { autoGenerate: false },
    })
    // Retain the instance before init so a failed boot can still close its pool.
    payload = new BasePayload()
    await payload.init({ config })
    const state = await pool.query<{ present: boolean }>('SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = $1 AND tablename = $2) AS present', [schemaName, 'xp_state'])
    if (!state.rows[0]?.present) throw new Error('Integration push did not create xp_state')
    return {
      payload, pool, schemaName, publicBefore,
      async teardown() {
        if (tornDown) return
        tornDown = true
        try {
          await destroyPayload()
        } finally {
          try {
            // schemaName is generated here, never supplied by a caller.
            if (!/^xp_it_[a-f0-9]+$/.test(schemaName)) throw new Error('Refusing to drop a non-integration schema')
            await pool.query(`DROP SCHEMA ${schema} CASCADE`)
          } finally {
            await pool.end()
          }
        }
      },
    }
  } catch (error) {
    try {
      try {
        await destroyPayload()
      } finally {
        try {
          if (schemaCreated) await pool.query(`DROP SCHEMA ${schema} CASCADE`)
        } finally {
          await pool.end()
        }
      }
    } catch (cleanupError) {
      // Preserve the original boot failure, including its identity and stack.
      if (error instanceof Error && Object.isExtensible(error) && error.cause === undefined) error.cause = cleanupError
      else console.error('Integration harness cleanup failed', cleanupError)
    }
    throw error
  }
}
