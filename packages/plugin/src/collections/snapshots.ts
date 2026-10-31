import type { CollectionConfig } from 'payload'
import type { ResolvedOptions } from '../types/contracts.js'
import { readOnlyAccess } from './access.js'

export function snapshotsCollection(options: ResolvedOptions): CollectionConfig {
  return {
    slug: 'xp-results-snapshots', graphQL: false, disableDuplicate: true, admin: { hidden: true },
    access: readOnlyAccess(options.access.readResults ?? options.access.manage), indexes: [{ fields: ['experiment', 'computedAt'] }],
    fields: [
      { name: 'experiment', type: 'relationship', relationTo: 'xp-experiments' },
      { name: 'phase', type: 'number', required: true }, { name: 'computedAt', type: 'date', required: true },
      { name: 'window', type: 'json', required: true }, { name: 'snapshot', type: 'json', required: true },
    ],
  }
}
