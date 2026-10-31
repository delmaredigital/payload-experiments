import type { Plugin } from 'payload'
import type { ExperimentsPluginOptions } from './types/contracts.js'
import { buildCollections } from './collections/index.js'
import { buildEndpoints } from './endpoints/index.js'
import { contentChangesHook } from './hooks/contentChanges.js'
import { createOnInit } from './onInit.js'
import { puckCollections, resolveOptions } from './options.js'

export function createExperimentsPlugin<TUser extends { id: string | number } = { id: string | number }>(input: ExperimentsPluginOptions<TUser>): Plugin {
  const options = resolveOptions(input)
  return config => {
    const registrations = puckCollections(options)
    for (const { slug } of registrations) {
      if (!config.collections?.some(collection => collection.slug === slug)) throw new Error(`Unknown experiments puck collection: ${slug}`)
    }
    // The frozen factories consume registration/access metadata, never TUser callbacks.
    // Erase the user subtype only at this non-generic factory boundary.
    const { collections, globals } = buildCollections(options as unknown as Parameters<typeof buildCollections>[0])
    const onInit = createOnInit(options)
    return {
      ...config,
      collections: [
        ...(config.collections ?? []).map(collection => options.puck?.enabled && registrations.some(entry => entry.slug === collection.slug) ? {
          ...collection, hooks: { ...collection.hooks, afterChange: [...(collection.hooks?.afterChange ?? []), contentChangesHook] },
        } : collection),
        ...collections,
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
