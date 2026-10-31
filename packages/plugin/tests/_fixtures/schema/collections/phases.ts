// Schema-only copy of CORE-02a ba8d1c703430d8908f13a3669a31f8e3bfb8a9b5; only external import paths adjusted.
import type { CollectionConfig, Field } from 'payload'
import type { ResolvedOptions } from '../../../../src/types/contracts.js'
import { readOnlyAccess } from './access.js'

export function phasesCollection(options: ResolvedOptions): CollectionConfig {
  return {
    slug: 'xp-phases', graphQL: false, disableDuplicate: true, admin: { hidden: true },
    access: readOnlyAccess(options.access.readResults ?? options.access.manage),
    fields: [
      { name: 'experiment', type: 'relationship', relationTo: 'xp-experiments', required: true },
      { name: 'phase', type: 'number', required: true },
      { name: 'phaseKind', type: 'select', required: true, options: ['test', 'rollout'] },
      { name: 'startedAt', type: 'date', required: true }, { name: 'endedAt', type: 'date' },
      { name: 'seed', type: 'text', required: true },
      ...['arms', 'allocation', 'allocationChanges', 'targeting', 'metricDefinitions', 'analysis', 'contentChanges'].map((name): Field => ({ name, type: 'json' })),
    ],
  }
}
