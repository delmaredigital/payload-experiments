import { ValidationError, type PayloadRequest } from 'payload'
import { placementReader } from '../blocks/placementLocale.js'
import { puckCollections } from '../options.js'
import { nestedTests, nestedTestKey, nestedTestLabel, nestedTestSlug } from '../puck/nestedTests.js'
import { nestedTestCopy } from '../puck/nestedTestCopy.js'
import type { ResolvedOptions } from '../types/contracts.js'

/** Called by the page guard with its published baseline and merged write, only on publish.
 * Puck's public reducer bypasses slot disallow; this server check covers that path.
 */
export function refuseNewNestedTests(req: PayloadRequest, collection: string, before: Record<string, unknown> | undefined,
  after: Record<string, unknown>, tests: readonly { slug: string; name: string }[]): void {
  const options = req.payload.config.custom?.xp as ResolvedOptions
  const registration = puckCollections(options).find(entry => entry.slug === collection)
  if (!registration) return
  const reader = placementReader(req, collection, options)
  for (const view of reader.views) {
    const read = (doc: Record<string, unknown> | undefined) => {
      const content = reader.read(doc, 'all-locales', view)
      return content.editor === 'puck' ? nestedTests(content.doc?.[registration.field]) : []
    }
    const existing = new Set(read(before).map(nestedTestKey))
    const added = read(after).find(pair => !existing.has(nestedTestKey(pair)))
    if (!added) continue
    const name = (block: typeof added.inner) => tests.find(test => test.slug === nestedTestSlug(block))?.name ?? nestedTestLabel(block)
    const message = nestedTestCopy(name(added.outer), name(added.inner))
    const error = new ValidationError({ collection, errors: [{ path: registration.field, message }] })
    error.message = message
    throw error
  }
}
