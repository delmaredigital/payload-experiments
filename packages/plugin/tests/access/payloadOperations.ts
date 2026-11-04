import { sanitizeConfig, type Config } from 'payload'

export async function payloadOperations() {
  const config = await sanitizeConfig({
    secret: 'test-only',
    // Sanitizing config never initializes this adapter or opens a connection.
    db: {} as Config['db'],
    collections: [{ slug: 'probe', fields: [] }],
    globals: [{ slug: 'probe-global', fields: [] }],
  })
  const collection = config.collections.find(config => config.slug === 'probe')!
  const global = config.globals.find(config => config.slug === 'probe-global')!
  // Only admin is excluded: it gates an auth collection's admin.user access.
  return {
    collectionOperations: Object.keys(collection.access).filter(operation => operation !== 'admin'),
    globalOperations: Object.keys(global.access).filter(operation => operation !== 'admin'),
  }
}
