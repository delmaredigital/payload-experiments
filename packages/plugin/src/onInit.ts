import type { Config } from 'payload'
import type { ResolvedOptions } from './types/contracts.js'

export function createOnInit<TUser extends { id: string | number }>(options: ResolvedOptions<TUser>): NonNullable<Config['onInit']> {
  return async payload => {
    // @payloadcms/db-postgres/dist/index.js:40 sets the adapter's public name.
    if (payload.db.name !== 'postgres') throw new Error('Experiments requires @payloadcms/db-postgres')
    const id = await payload.db.beginTransaction()
    if (id === null) throw new Error('Experiments requires enabled database transactions')
    await payload.db.rollbackTransaction(id)
    if (Object.hasOwn(options.attributeKeys ?? {}, 'staff') && typeof options.runtime.attributesOf !== 'function') {
      throw new Error('Experiments staff attribute requires runtime.attributesOf')
    }
  }
}
