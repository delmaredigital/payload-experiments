import type { CollectionConfig } from 'payload'
import type { ResolvedOptions } from '../types/contracts.js'
import { XpRefusal } from '../errors.js'
import { XP_LAYER_USAGE } from '../admin/paths.js'
import { managedAccess } from './access.js'

export function layersCollection(options: ResolvedOptions): CollectionConfig {
  return {
    slug: 'xp-layers', graphQL: false, disableDuplicate: true, admin: { useAsTitle: 'name' }, access: managedAccess(options),
    fields: [
      { name: 'name', type: 'text', required: true },
      { name: 'slug', type: 'text', unique: true, required: true,
        validate: (value: unknown, { operation, previousValue }: { operation?: string; previousValue?: unknown }) => {
          if (operation === 'update' && value === undefined) return true
          if (typeof value !== 'string' || !value.length) return 'Enter a slug.'
          return operation !== 'update' || value === previousValue || 'slug is set when the layer is created.'
        } },
      { name: 'unitType', type: 'select', required: true, options: ['visitor', 'user'],
        validate: (value: unknown, { operation, previousValue }: { operation?: string; previousValue?: unknown }) => {
          if (operation === 'update' && value === undefined) return true
          if (value !== 'visitor' && value !== 'user') return 'Choose visitors or signed-in users.'
          return operation !== 'update' || value === previousValue || 'unitType is set when the layer is created.'
        } },
      { name: 'description', type: 'textarea' },
      { name: 'usage', type: 'ui', admin: { components: { Field: XP_LAYER_USAGE } } },
    ],
    hooks: {
      beforeDelete: [async ({ id, req }) => {
        const references = await req.payload.find({ collection: 'xp-experiments', where: { layer: { equals: id } }, limit: 1, overrideAccess: false, req })
        if (references.docs.length) throw new XpRefusal('invalid-status', 'This layer is still referenced by an experiment.', undefined, 409)
      }],
    },
  }
}
