import { fileURLToPath } from 'node:url'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { buildConfig } from 'payload'
import type { ResolvedOptions } from '../../../src/types/contracts.js'
import { createExperimentBlock } from '../../../src/blocks/createExperimentBlock.js'
import { buildCollections } from '../../../src/collections/index.js'

// Build the collections and global from source so regeneration cannot use stale copies.
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
  collections: [{ slug: 'users', auth: true, fields: [] }, { slug: 'fixture-pages', versions: { drafts: true }, fields: [{ name: 'layout', type: 'blocks', blocks: [{ slug: 'text', fields: [{ name: 'text', type: 'text' }] }, createExperimentBlock({ blocks: [{ slug: 'text', fields: [{ name: 'text', type: 'text' }] }] })] }] }, ...collections],
  globals,
  typescript: { autoGenerate: false },
})
