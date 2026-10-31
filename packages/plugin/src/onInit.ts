import type { Config } from 'payload'
import type { ResolvedOptions } from './types/contracts.js'
import { assertPostgresAdapter, probeTransactions } from './db/adapter.js'
import { hasHostAttributesOf } from './server/serverRuntime.js'

export function createOnInit<TUser extends { id: string | number }>(options: ResolvedOptions<TUser>): NonNullable<Config['onInit']> {
  return async payload => {
    assertPostgresAdapter(payload)
    await probeTransactions(payload)
    if (Object.hasOwn(options.attributeKeys ?? {}, 'staff') && !hasHostAttributesOf(options.runtime)) {
      throw new Error('`staff` is declared in attributeKeys, so pass an `attributesOf` that identifies staff to defineExperimentsServerRuntime')
    }
  }
}
