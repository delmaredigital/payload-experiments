// Schema-only copy of CORE-02a ba8d1c703430d8908f13a3669a31f8e3bfb8a9b5; only external import paths adjusted.
import type { CollectionConfig } from 'payload'
import type { ResolvedOptions } from '../../../../src/types/contracts.js'
import { readOnlyAccess } from './access.js'

export function identitiesCollection(options: ResolvedOptions): CollectionConfig {
  return {
    slug: 'xp-identities', graphQL: false, disableDuplicate: true, admin: { hidden: true },
    access: readOnlyAccess(options.access.readIdentities ?? options.access.admin ?? options.access.manage),
    fields: [
      { name: 'anonymousId', type: 'text', unique: true, required: true },
      { name: 'userId', type: 'text', required: true }, { name: 'linkedAt', type: 'date', required: true },
    ],
  }
}
