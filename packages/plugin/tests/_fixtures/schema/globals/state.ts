// Schema-only copy of CORE-02a ba8d1c703430d8908f13a3669a31f8e3bfb8a9b5; only external import paths adjusted.
import type { GlobalConfig } from 'payload'
import type { ResolvedOptions } from '../../../../src/types/contracts.js'
import { deny, isTrue } from '../collections/access.js'

export function stateGlobal(options: ResolvedOptions): GlobalConfig {
  return {
    slug: 'xp-state', dbName: 'xp_state', graphQL: false, admin: { hidden: true },
    access: { read: isTrue(options.access.manage), update: deny, readVersions: deny },
    fields: [
      { name: 'revision', type: 'number', defaultValue: 0 },
      { name: 'manifest', type: 'json' }, { name: 'flagDefaults', type: 'json' },
    ],
  }
}
