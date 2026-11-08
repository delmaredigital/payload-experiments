import type { Plugin } from 'payload'
import type { ExperimentsPluginOptions } from './types/contracts.js'
import { buildCollections } from './collections/index.js'
import { buildEndpoints } from './endpoints/index.js'
import { contentChangesBeforeHook, contentChangesHook } from './hooks/contentChanges.js'
import { puckGoalsBeforeChange } from './hooks/puckGoals.js'
import { pageGuardAfterChange, pageGuardAfterOperation, pageGuardBeforeChange, pageGuardBeforeDelete, pageGuardBeforeOperation } from './hooks/pageGuard.js'
import { createOnInit } from './onInit.js'
import { puckCollections, resolveOptions } from './options.js'
import { injectTestBlock } from './admin/blocks/inject.js'
import * as paths from './admin/paths.js'

export function createExperimentsPlugin<TUser extends { id: string | number } = { id: string | number }>(input: ExperimentsPluginOptions<TUser>): Plugin {
  const options = resolveOptions(input)
  return config => {
    const registrations = puckCollections(options)
    for (const { slug } of registrations) {
      if (!config.collections?.some(collection => collection.slug === slug)) throw new Error(`Unknown experiments puck collection: ${slug}`)
    }
    for (const { slug } of options.pages?.collections ?? []) {
      if (!config.collections?.some(collection => collection.slug === slug)) throw new Error(`Unknown experiments page collection: ${slug}`)
    }
    for (const { slug } of options.blocks?.collections ?? []) {
      if (!config.collections?.some(collection => collection.slug === slug)) throw new Error(`Unknown experiments blocks collection: ${slug}`)
    }
    // The frozen factories consume registration/access metadata, never TUser callbacks.
    // Erase the user subtype only at this non-generic factory boundary.
    const { collections, globals } = buildCollections(options as unknown as Parameters<typeof buildCollections>[0])
    const onInit = createOnInit(options)
    return {
      ...config,
      admin: { ...config.admin,
        dependencies: { ...config.admin?.dependencies,
          xpTestsSurface: { path: paths.XP_TESTS_SURFACE, type: 'component' },
        },
        components: { ...config.admin?.components,
        views: { ...config.admin?.components?.views, xpTests: { Component: paths.XP_TESTS_VIEW, path: '/experiments/:segments*' } },
      } },
      collections: [
        ...['xp-experiments', 'xp-metrics'].map(slug => collections.find(collection => collection.slug === slug)!),
        ...(config.collections ?? []).map(collection => {
          const puck = options.puck?.enabled && registrations.find(entry => entry.slug === collection.slug)
          const page = options.pages?.collections.some(entry => entry.slug === collection.slug)
          const blocks = options.blocks?.collections.find(entry => entry.slug === collection.slug)
          if (!puck && !page && !blocks) return collection
          return { ...collection, fields: [...(page ? [{ name: 'xpPlacementStatus', type: 'ui' as const, admin: { position: 'sidebar' as const, components: { Field: paths.XP_PLACEMENT_STATUS } } }] : []), ...(blocks ? injectTestBlock(collection.fields, blocks) : collection.fields)], hooks: { ...collection.hooks,
            beforeChange: [...(collection.hooks?.beforeChange ?? []), pageGuardBeforeChange, contentChangesBeforeHook, ...(puck ? [puckGoalsBeforeChange(puck.field)] : [])],
            beforeOperation: [...(collection.hooks?.beforeOperation ?? []), pageGuardBeforeOperation],
            beforeDelete: [...(collection.hooks?.beforeDelete ?? []), pageGuardBeforeDelete],
            afterOperation: [pageGuardAfterOperation, ...(collection.hooks?.afterOperation ?? [])],
            afterChange: [...(collection.hooks?.afterChange ?? []), pageGuardAfterChange, contentChangesHook],
          } }
        }),
        ...collections.filter(collection => collection.slug !== 'xp-experiments' && collection.slug !== 'xp-metrics'),
      ],
      globals: [...(config.globals ?? []), ...globals],
      endpoints: [...(config.endpoints ?? []), ...buildEndpoints({ options })],
      custom: { ...config.custom, xp: options },
      onInit: async payload => {
        await config.onInit?.(payload)
        await onInit(payload)
      },
    }
  }
}
