// Schema-only copy of CORE-02a ba8d1c703430d8908f13a3669a31f8e3bfb8a9b5; only external import paths adjusted.
import type { CollectionConfig } from 'payload'
import type { ResolvedOptions } from '../../../../src/types/contracts.js'
import { readOnlyAccess } from './access.js'

export function snapshotsCollection(options: ResolvedOptions): CollectionConfig {
  return {
    slug: 'xp-results-snapshots', graphQL: false, disableDuplicate: true, admin: { hidden: true },
    access: readOnlyAccess(options.access.readResults ?? options.access.manage), indexes: [{ fields: ['experiment', 'computedAt'] }],
    fields: [
      { name: 'experiment', type: 'relationship', relationTo: 'xp-experiments', required: true },
      { name: 'phase', type: 'number', required: true }, { name: 'computedAt', type: 'date', required: true },
      { name: 'window', type: 'json', required: true }, { name: 'snapshot', type: 'json', required: true },
    ],
  }
}
