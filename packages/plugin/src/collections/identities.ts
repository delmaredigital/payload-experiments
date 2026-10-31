import type { CollectionConfig } from 'payload'
import type { ResolvedOptions } from '../types/contracts.js'
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
