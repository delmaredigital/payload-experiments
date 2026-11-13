import { puckCollections } from './options.js'
import { pageGuardEnterOperation } from './hooks/pageGuard.js'
import { findRegisteredBlocksField } from './blocks/formState.js'
import { EXPERIMENT_BLOCK_SLUG } from './blocks/model.js'
import { contentBlocks } from './transitions/contentFields.js'
import type { Config, Field } from 'payload'
import type { ResolvedOptions } from './types/contracts.js'
import { validateDimensions } from './events/dimensions.js'
import { assertPostgresAdapter, probeTransactions } from './db/adapter.js'
import { hasHostAttributesOf } from './server/serverRuntime.js'

// Diagnostic only: named containers are never accepted by the top-level readers.
function registeredPaths(fields: readonly Field[], name: string, parent: string[] = []): string[] {
  return fields.flatMap(field => {
    const path = 'name' in field && field.name ? [...parent, field.name] : parent
    if (field.type === 'blocks' && field.name === name) return [path.join('.')]
    if (field.type === 'tabs') return field.tabs.flatMap(tab => registeredPaths(tab.fields, name, 'name' in tab && tab.name ? [...path, tab.name] : path))
    return 'fields' in field ? registeredPaths(field.fields, name, path) : []
  })
}

export function createOnInit<TUser extends { id: string | number }>(options: ResolvedOptions<TUser>): NonNullable<Config['onInit']> {
  return async payload => {
    const guarded = new Set([...(options.puck?.enabled ? puckCollections(options).map(c => c.slug) : []), ...(options.blocks?.collections ?? []).map(c => c.slug), ...(options.pages?.collections ?? []).map(c => c.slug)])
    for (const collection of payload.config.collections ?? []) {
      if (!guarded.has(collection.slug)) continue
      // Page-only guards also read the raw main row's scalar _status when
      // protecting unpublishes and restores; localized status breaks those too.
      if (payload.config.localization && payload.config.experimental?.localizeStatus
        && collection.versions && collection.versions.drafts && collection.versions.drafts.localizeStatus) {
        throw new Error(`Experiments collection ${collection.slug} does not support versions.drafts.localizeStatus. Use a shared publication status.`)
      }
      if (collection.hooks) {
        const hooks = collection.hooks.beforeOperation ?? []
        collection.hooks.beforeOperation = [pageGuardEnterOperation, ...hooks.filter(hook => hook !== pageGuardEnterOperation)]
      }
    }

    for (const registration of options.blocks?.collections ?? []) {
      const config = payload.config.collections.find(c => c.slug === registration.slug)
      const found = findRegisteredBlocksField(config?.fields ?? [], registration.field)
      if (!found) throw new Error(`Experiments blocks field ${registration.slug}.${registeredPaths(config?.fields ?? [], registration.field)[0] ?? registration.field} must be a top-level blocks field and must contain ${registration.blockSlug ?? EXPERIMENT_BLOCK_SLUG}`)
      if (!contentBlocks(found.field, payload.config.blocks).some(b => b.slug === (registration.blockSlug ?? EXPERIMENT_BLOCK_SLUG))) {
        throw new Error(`Experiments blocks field ${registration.slug}.${registration.field} must contain ${registration.blockSlug ?? EXPERIMENT_BLOCK_SLUG}`)
      }
    }
    if (options.metricSources?.some(source => source.id.startsWith('click:'))) throw new Error('metricSources ids starting with click: are reserved for click goals')
    validateDimensions(options.events?.dimensions)
    assertPostgresAdapter(payload)
    await probeTransactions(payload)
    if (Object.hasOwn(options.attributeKeys ?? {}, 'staff') && !hasHostAttributesOf(options.runtime)) {
      throw new Error('`staff` is declared in attributeKeys, so pass an `attributesOf` that identifies staff to defineExperimentsServerRuntime')
    }
  }
}
