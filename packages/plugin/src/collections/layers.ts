import type { CollectionConfig } from 'payload'
import type { ResolvedOptions } from '../types/contracts.js'
import { XpRefusal } from '../errors.js'
import { XP_LAYER_USAGE } from '../admin/paths.js'
import { managedAccess } from './access.js'

export function layersCollection(options: ResolvedOptions): CollectionConfig {
  const usageAdmin = { description: 'See which tests use this group and how much room is left.', components: { Field: XP_LAYER_USAGE } }
  return {
    slug: 'xp-layers', graphQL: false, disableDuplicate: true,
    // group:false hides navigation while keeping collection routes reachable (hidden causes 404s).
    labels: { singular: 'Test group', plural: 'Test groups (advanced)' }, admin: { group: false, useAsTitle: 'name' }, access: managedAccess(options),
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, admin: { description: 'Give this test group a name people will recognize.' } },
      { name: 'slug', label: 'Short name (used in code)', type: 'text', unique: true, required: true, admin: { description: 'Use a unique short name for code that refers to this group.' },
        validate: (value: unknown, { operation, previousValue }: { operation?: string; previousValue?: unknown }) => {
          if (operation === 'update' && value === undefined) return true
          if (typeof value !== 'string' || !value.length) return 'Enter a short name.'
          return operation !== 'update' || value === previousValue || "The short name can't change after the group is created."
        } },
      { name: 'unitType', label: 'Counts', type: 'select', required: true, options: [{ label: 'Visitors', value: 'visitor' }, { label: 'Signed-in users', value: 'user' }], admin: { description: 'Choose whether tests in this group count visitors or signed-in users.' },
        validate: (value: unknown, { operation, previousValue }: { operation?: string; previousValue?: unknown }) => {
          if (operation === 'update' && value === undefined) return true
          if (value !== 'visitor' && value !== 'user') return 'Choose visitors or signed-in users.'
          return operation !== 'update' || value === previousValue || "Who it counts can't change after the group is created."
        } },
      { name: 'description', label: 'Notes', type: 'textarea', admin: { description: 'Explain when people should use this test group.' } },
      { name: 'usage', label: 'Tests in this group', type: 'ui', admin: usageAdmin },
    ],
    hooks: {
      beforeDelete: [async ({ id, req }) => {
        // The delete already passed layers access; a refused nested read would kill the caller's transaction (Payload killTransaction) and could hide a referencing experiment.
        const references = await req.payload.find({ collection: 'xp-experiments', where: { layer: { equals: id } }, limit: 1, overrideAccess: true, req })
        if (references.docs.length) throw new XpRefusal('invalid-status', 'This layer is still referenced by an experiment.', undefined, 409)
      }],
    },
  }
}
