import type { Config } from 'payload'
import type { ResolvedOptions } from './types/contracts.js'
import { validateDimensions } from './events/dimensions.js'
import { assertPostgresAdapter, probeTransactions } from './db/adapter.js'

export function createOnInit<TUser extends { id: string | number }>(options: ResolvedOptions<TUser>): NonNullable<Config['onInit']> {
  return async payload => {
    validateDimensions(options.events?.dimensions)
    assertPostgresAdapter(payload)
    await probeTransactions(payload)
    if (Object.hasOwn(options.attributeKeys ?? {}, 'staff') && typeof options.runtime.attributesOf !== 'function') {
      throw new Error('Experiments staff attribute requires runtime.attributesOf')
    }
  }
}
