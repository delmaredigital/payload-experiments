import type { PayloadRequest } from 'payload'
import { formatAdminURL } from 'payload/shared'
import type { ExperimentsPageCollection } from '../types/contracts.js'
import { collectionLabel } from '../collections/labels.js'

export function serializePageCollections(collections: ExperimentsPageCollection[], req: PayloadRequest) {
  return collections.map(entry => {
    const label = collectionLabel(req.payload.config.collections.find(collection => collection.slug === entry.slug)?.labels.plural, entry.slug, req)
    return { slug: entry.slug, label, ...(entry.copyHint ? { copyHint: entry.copyHint } : {}),
      copyUrl: entry.copyUrl ?? formatAdminURL({ adminRoute: req.payload.config.routes.admin, path: `/collections/${entry.slug}` }),
      copyLabel: entry.copyLabel ?? `Open ${label}` }
  })
}
