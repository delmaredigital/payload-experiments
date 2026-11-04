import type { GlobalConfig } from 'payload'
import type { ResolvedOptions } from '../types/contracts.js'
import { preserveRetiredSlugs } from '../db/slugs.js'
import { deny, isTrue } from '../collections/access.js'

export function stateGlobal(options: ResolvedOptions): GlobalConfig {
  return {
    slug: 'xp-state', dbName: 'xp_state', graphQL: false, versions: false, admin: { hidden: true },
    access: { read: isTrue(options.access.manage), update: deny, readVersions: deny },
    hooks: { beforeChange: [preserveRetiredSlugs] },
    fields: [
      { name: 'revision', type: 'number', defaultValue: 0 },
      { name: 'retiredSlugs', type: 'json' },
      { name: 'manifest', type: 'json' }, { name: 'flagDefaults', type: 'json' },
    ],
  }
}
