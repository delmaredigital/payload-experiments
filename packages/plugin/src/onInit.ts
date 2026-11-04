import { findRegisteredBlocksField } from './blocks/formState.js'
import { EXPERIMENT_BLOCK_SLUG } from './blocks/model.js'
import { contentBlocks } from './transitions/contentFields.js'
import type { Config } from 'payload'
import type { ResolvedOptions } from './types/contracts.js'
import { validateDimensions } from './events/dimensions.js'
import { assertPostgresAdapter, probeTransactions } from './db/adapter.js'
import { hasHostAttributesOf } from './server/serverRuntime.js'

export function createOnInit<TUser extends { id: string | number }>(options: ResolvedOptions<TUser>): NonNullable<Config['onInit']> {
  return async payload => {
    for (const registration of options.blocks?.collections ?? []) {
      const config = payload.config.collections.find(c => c.slug === registration.slug)
      const found = findRegisteredBlocksField(config?.fields ?? [], registration.field)
      if (!found || !contentBlocks(found.field, payload.config.blocks).some(b => b.slug === (registration.blockSlug ?? EXPERIMENT_BLOCK_SLUG))) {
        throw new Error(`Experiments blocks field ${registration.slug}.${registration.field} must contain ${registration.blockSlug ?? EXPERIMENT_BLOCK_SLUG}`)
      }
    }
    validateDimensions(options.events?.dimensions)
    assertPostgresAdapter(payload)
    await probeTransactions(payload)
    if (Object.hasOwn(options.attributeKeys ?? {}, 'staff') && !hasHostAttributesOf(options.runtime)) {
      throw new Error('`staff` is declared in attributeKeys, so pass an `attributesOf` that identifies staff to defineExperimentsServerRuntime')
    }
  }
}
