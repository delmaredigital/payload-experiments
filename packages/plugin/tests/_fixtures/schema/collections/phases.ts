// Schema-only copy from main d292db4e74d036d15d012ce1b5892dc4ad1f5ba6; only external import paths adjusted.
import type { CollectionConfig, Field } from 'payload'
import type { ResolvedOptions } from '../../../../src/types/contracts.js'
import { readOnlyAccess } from './access.js'

export function phasesCollection(options: ResolvedOptions): CollectionConfig {
  return {
    slug: 'xp-phases', graphQL: false, disableDuplicate: true, admin: { hidden: true },
    access: readOnlyAccess(options.access.readResults ?? options.access.manage),
    fields: [
      { name: 'experiment', type: 'relationship', relationTo: 'xp-experiments' },
      { name: 'phase', type: 'number', required: true },
      { name: 'phaseKind', type: 'select', required: true, options: ['test', 'rollout'] },
      { name: 'startedAt', type: 'date', required: true }, { name: 'endedAt', type: 'date' },
      { name: 'seed', type: 'text', required: true },
      ...['arms', 'allocation', 'allocationChanges', 'targeting', 'metricDefinitions', 'analysis', 'contentChanges'].map((name): Field => ({ name, type: 'json' })),
    ],
  }
}
