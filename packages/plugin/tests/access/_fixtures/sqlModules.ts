export {}
import { sql as query } from '@payloadcms/db-postgres'
export { sql } from 'drizzle-orm'
export * from 'drizzle-orm/pg-core'
void import('drizzle-orm/pg-core')
declare const require: (name: string) => any
require('@payloadcms/db-postgres')
void query
