import type { Executor } from './executor.js'

/** Quote schema/table/column identifiers; data values still use parameters. */
export const quoteIdentifier = (name: string): string => `"${name.replaceAll('"', '""')}"`

/** Preserve the schema carried by the request's executor for raw plugin SQL. */
export function qualifiedTable(exec: Executor, name: string): string {
  const schemaName = (exec as Executor & { schemaName?: string }).schemaName
  return `${schemaName ? `${quoteIdentifier(schemaName)}.` : ''}${quoteIdentifier(name)}`
}
