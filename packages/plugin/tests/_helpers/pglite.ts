import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { pushSchema } from 'drizzle-kit/api'
import * as schema from '../_fixtures/generated-schema.js'

/** Fresh in-process Postgres; the generated fixture is the only schema source. */
export async function createPgliteDb() {
  const client = new PGlite()
  try {
    const db = drizzle(client, { schema })
    // drizzle-kit types its introspection connection without a relational schema.
    // Both wrappers share the same in-process client; callers keep typed queries.
    const push = await pushSchema(schema, drizzle(client))
    if (push.hasDataLoss || push.warnings.length) {
      throw new Error(`Unexpected schema push warning on an empty database: ${push.warnings.join('; ')}`)
    }
    await push.apply()
    return { client, db, close: () => client.close() }
  } catch (error) {
    await client.close()
    throw error
  }
}
