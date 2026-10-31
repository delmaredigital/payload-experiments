import { fileURLToPath } from 'node:url'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { buildConfig } from 'payload'
import type { ResolvedOptions } from '../../../src/types/contracts.js'
import { buildCollections } from './collections/index.js'

// These factories are copied from CORE-02a while that lane is in review.
// Refresh the copies and regenerate if its fields change before merging.
const sampleOptions: ResolvedOptions = {
  access: { manage: () => true },
  runtime: {
    proxyRuntime: {
      secrets: ['schema-fixture-only'], apiRoute: '/api/xp',
      cookie: { name: 'xp_id', maxAgeDays: 365 },
    },
    getPayload: async () => { throw new Error('Schema generation must not load a live Payload instance') },
    userIdOf: user => String(user.id),
    attributesOf: user => ({ loggedIn: Boolean(user) }),
  },
  metricSources: [], flagPoints: [], attributeKeys: {},
}

const { collections, globals } = buildCollections(sampleOptions)

export default buildConfig({
  secret: 'schema-fixture-only',
  db: postgresAdapter({
    pool: { connectionString: 'postgres://unused@127.0.0.1:1/none' },
    generateSchemaOutputFile: fileURLToPath(new URL('../generated-schema.ts', import.meta.url)),
  }),
  collections: [{ slug: 'users', auth: true, fields: [] }, ...collections],
  globals,
  typescript: { autoGenerate: false },
})
