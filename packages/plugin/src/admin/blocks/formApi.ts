import type { ClientBlock, ClientConfig, ClientField, Field, FormState } from 'payload'
import type { useForm, useServerFunctions } from '@payloadcms/ui'
import { EXPERIMENT_BLOCK_SLUG, hostBlocks, type HostBlock } from '../../blocks/model.js'
import { BLOCK_COPY } from '../../admin/copy/blocks.js'

/** The only form-state failure with block-specific editor copy. */
export class BlockChangedError extends Error {
  constructor() { super(BLOCK_COPY.blockChanged) }
}

/** An API refusal already translated into editor-facing copy. */
export class RefusalError extends Error {}

export type RowsField = Extract<Field, { type: 'blocks' }>
export const wrapMode: 'form-api' | 'fallback' = 'form-api'

/** Client twin: unnamed layout containers do not contribute to a data path. */
export function findClientBlocksField(fields: readonly ClientField[], name: string): Extract<ClientField, { type: 'blocks' }> | undefined {
  for (const field of fields) {
    if (field.type === 'blocks' && field.name === name) return field
    if (field.type === 'row' || field.type === 'collapsible') {
      const found = findClientBlocksField(field.fields, name)
      if (found) return found
    }
    if (field.type === 'tabs') for (const tab of field.tabs) {
      if ('name' in tab && tab.name) continue
      const found = findClientBlocksField(tab.fields, name)
      if (found) return found
    }
  }
}

/** Only schema structure is needed by the pure helpers, never server validators.
 * Resolve references at every depth, including inside the Experiment slots field.
 */
export function adaptClientBlocksField(field: Extract<ClientField, { type: 'blocks' }>, config: Pick<ClientConfig, 'blocks'>): RowsField {
  function block(block: ClientBlock): unknown { return { ...block, fields: block.fields.map(adapt) } }
  function adapt(field: ClientField): unknown {
    if (field.type === 'blocks') return { ...field, blocks: [
      ...field.blocks.map(block), ...(field.blockReferences ?? []).flatMap(reference => {
        const resolved = typeof reference === 'string' ? config.blocks?.find(item => item.slug === reference) : reference
        return resolved ? [block(resolved)] : []
      }),
    ], blockReferences: [] }
    if ('fields' in field) return { ...field, fields: field.fields.map(adapt) }
    if (field.type === 'tabs') return { ...field, tabs: field.tabs.map(tab => ({ ...tab, fields: tab.fields.map(adapt) })) }
    return field
  }
  return adapt(field) as RowsField
}
export function experimentBlockSlug(field: RowsField): string {
  return field.blocks.find(block => block.fields.some(field => 'name' in field && field.name === 'xpBlockStatus'))?.slug ?? EXPERIMENT_BLOCK_SLUG
}
export function rowLocation(path: string): { field: string; index: number } | undefined {
  const match = /^([^.]+)\.(\d+)(?:\.|$)/.exec(path)
  return match ? { field: match[1]!, index: Number(match[2]) } : undefined
}
export function dataAt(data: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, data)
}

/** Stable object keys; array order and scalar values remain significant. */
function stringify(value: unknown): string | undefined {
  return JSON.stringify(value, (_, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item)
}

/** Payload 3.90.2 and 4 beta.6 use the same row APIs. Sync replaces the whole
 * wrapper so add/drop/reorder and the server-rendered component slots stay together.
 * N=0 needs UPDATE: removeFieldRow alone serializes the empty field as number 0.
 */
export async function replaceBlockRow(args: {
  form: ReturnType<typeof useForm>; getFormState: ReturnType<typeof useServerFunctions>['getFormState']
  collectionSlug: string; id?: string | number; field: string; index: number; rows: HostBlock[]
  expectedBlock?: HostBlock
  docPermissions?: Parameters<ReturnType<typeof useServerFunctions>['getFormState']>[0]['docPermissions']
  docPreferences?: Parameters<ReturnType<typeof useServerFunctions>['getFormState']>[0]['docPreferences']
}): Promise<void> {
  const { form, getFormState, collectionSlug, id, field, index, rows } = args
  const data = form.getData(), before = hostBlocks(data[field])
  if (args.expectedBlock && stringify(form.getDataByPath(`${field}.${index}`)) !== stringify(args.expectedBlock)) throw new BlockChangedError()
  // Compare the same reader on both sides: getData() keeps empty row counts as 0.
  const original = stringify(form.getDataByPath(field))
  const next = [...before.slice(0, index), ...rows, ...before.slice(index + 1)]
  const result = await getFormState({ collectionSlug, id, schemaPath: collectionSlug,
    data: { ...data, [field]: next }, docPermissions: args.docPermissions,
    docPreferences: args.docPreferences ?? { fields: {} }, operation: id == null ? 'create' : 'update',
    renderAllFields: true, skipValidation: true,
  })
  if (stringify(form.getDataByPath(field)) !== original) throw new BlockChangedError()
  if (!result.state) throw new Error('Missing server form state')
  const state = result.state
  function subFieldState(rowIndex: number): FormState {
    const prefix = `${field}.${rowIndex}.`
    return Object.fromEntries(Object.entries(state).filter(([path]) => path.startsWith(prefix)).map(([path, value]) => [path.slice(prefix.length), value]))
  }
  if (!rows.length) {
    form.removeFieldRow({ path: field, rowIndex: index })
    if (next.length === 0) form.dispatchFields({ type: 'UPDATE', path: field, value: [], disableFormData: false })
    return
  }
  form.replaceFieldRow({ path: field, rowIndex: index, schemaPath: `${collectionSlug}.${field}`, blockType: rows[0]!.blockType, subFieldState: subFieldState(index) })
  for (let offset = 1; offset < rows.length; offset++) form.addFieldRow({
    path: field, rowIndex: index + offset, schemaPath: `${collectionSlug}.${field}`, blockType: rows[offset]!.blockType, subFieldState: subFieldState(index + offset),
  })
  // REPLACE_ROW invents a metadata id even when the data id is unchanged.
  // Keep server row metadata (including custom labels) and the wrapper React key:
  // otherwise a sync remounts the status field and loses its save notice.
  const oldRows = form.getFields()[field]?.rows ?? []
  const serverRows = state[field]?.rows
  if (serverRows) form.dispatchFields({ type: 'UPDATE', path: field, rows: serverRows.map(row => ({ ...oldRows.find(old => old.id === row.id), ...row })) })
}
