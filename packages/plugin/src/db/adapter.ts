import type { Payload } from 'payload'

export function assertPostgresAdapter(payload: Payload): void {
  // @payloadcms/db-postgres/dist/index.js:133 declares this package marker.
  if (payload.db.packageName !== '@payloadcms/db-postgres') throw new Error('Experiments requires @payloadcms/db-postgres')
}

export async function probeTransactions(payload: Payload): Promise<void> {
  const id = await payload.db.beginTransaction()
  if (id == null) throw new Error('Experiments transactions are disabled')
  await payload.db.rollbackTransaction(id)
}
