// Schema-only copy of CORE-02a ba8d1c703430d8908f13a3669a31f8e3bfb8a9b5; only external import paths adjusted.
import type { CollectionConfig } from 'payload'
import type { ResolvedOptions } from '../../../../src/types/contracts.js'
import { readOnlyAccess } from './access.js'

export function eventsCollection(options: ResolvedOptions): CollectionConfig {
  return {
    slug: 'xp-events', graphQL: false, disableDuplicate: true, admin: { hidden: true },
    access: readOnlyAccess(options.access.readIdentities ?? options.access.admin ?? options.access.manage),
    indexes: [{ fields: ['experiment', 'phase', 'type', 'ts'] }, { fields: ['unitId', 'experiment'] }, { fields: ['type', 'eventName', 'ts'] }],
    fields: [
      { name: 'type', type: 'select', required: true, options: ['exposure', 'conversion', 'arm-mismatch'] },
      { name: 'experiment', type: 'relationship', relationTo: 'xp-experiments' },
      { name: 'phase', type: 'number' }, { name: 'arm', type: 'text' },
      { name: 'unitId', type: 'text', required: true },
      { name: 'unitType', type: 'select', required: true, options: ['visitor', 'user'] },
      { name: 'userId', type: 'text' }, { name: 'eventName', type: 'text' },
      { name: 'value', type: 'number' }, { name: 'ts', type: 'date', required: true },
      { name: 'attributes', type: 'json' }, { name: 'dedupeKey', type: 'text', unique: true, index: true, required: true },
    ],
  }
}
