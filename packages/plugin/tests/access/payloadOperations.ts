import { sanitizeConfig, type CollectionConfig, type Config, type GlobalConfig } from 'payload'

/** The access operations every plugin collection and global states. */
export const collectionOperations = ['create', 'read', 'update', 'delete', 'readVersions', 'unlock'] as const
export const globalOperations = ['read', 'update', 'readVersions'] as const

type Unlisted<T, Listed> = Exclude<keyof NonNullable<T>, Listed>
// Fails typecheck when Payload's types gain an access operation the lists omit, including one Payload
// reads but does not default (readVersions today). admin applies only to an auth collection's admin.user.
export const listsCoverPayloadTypes: [Unlisted<CollectionConfig['access'], (typeof collectionOperations)[number] | 'admin'>,
  Unlisted<GlobalConfig['access'], (typeof globalOperations)[number]>] extends [never, never] ? true : never = true

/** The access operations Payload's sanitize assigns to a bare collection and global. */
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
  return {
    // Only admin is excluded: it gates an auth collection's admin.user access.
    collectionOperations: Object.keys(collection.access).filter(operation => operation !== 'admin'),
    globalOperations: Object.keys(global.access),
  }
}
