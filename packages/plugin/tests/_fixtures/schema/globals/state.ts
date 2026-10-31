// Schema-only copy from main d292db4e74d036d15d012ce1b5892dc4ad1f5ba6; only external import paths adjusted.
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
