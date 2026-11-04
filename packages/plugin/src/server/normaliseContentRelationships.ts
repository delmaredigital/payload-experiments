import type { Block, Field } from 'payload'
import { contentBlocks } from '../transitions/contentFields.js'

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const id = (value: unknown): unknown => object(value) && 'id' in value ? value.id : value

/** Undo depth expansion only where the collection schema declares relationships.
 * Hidden fields and field-level afterRead hooks are unaffected by depth, so
 * relationship expansion is the only depth-dependent transformation to undo.
 * Other objects (especially JSON content with its own ids) must stay intact.
 */
export function normaliseContentRelationships(data: unknown, fields: Field[], blocks: Block[] = [], locales: readonly string[] = []): unknown {
  // With locale 'all', a localized field's value is { [locale]: value }: normalise each locale's value.
  const localeMap = (value: unknown): value is Record<string, unknown> => locales.length > 0 && object(value)
    && Object.keys(value).length > 0 && Object.keys(value).every(key => locales.includes(key))
  function lexical(value: unknown): unknown {
    if (!object(value)) return value
    const result = { ...value }
    if (value.type === 'upload' || value.type === 'relationship') result.value = id(value.value)
    if (Array.isArray(value.children)) result.children = value.children.map(lexical)
    if (object(value.root)) result.root = lexical(value.root)
    return result
  }
  function fieldValue(value: unknown, field: Field): unknown {
    if (field.type === 'relationship' || field.type === 'upload') {
      const one = (entry: unknown) => Array.isArray(field.relationTo) && object(entry)
        ? { ...entry, value: id(entry.value) } : id(entry)
      return field.hasMany && Array.isArray(value) ? value.map(one) : one(value)
    }
    if (field.type === 'richText') return lexical(value)
    if (field.type === 'array' && Array.isArray(value)) return value.map(row => walk(row, field.fields))
    if (field.type === 'blocks' && Array.isArray(value)) return value.map(row => {
      const block = object(row) && contentBlocks(field, blocks).find(block => block.slug === row.blockType)
      return block ? walk(row, block.fields) : row
    })
    return 'fields' in field ? walk(value, field.fields) : value
  }
  function walk(value: unknown, schema: Field[]): unknown {
    if (!object(value)) return value
    let result = { ...value }
    for (const field of schema) {
      if (field.type === 'tabs') {
        for (const tab of field.tabs) {
          if ('name' in tab && tab.name) {
            if (tab.name in result) result[tab.name] = walk(result[tab.name], tab.fields)
          } else result = walk(result, tab.fields) as Record<string, unknown>
        }
      } else if ('name' in field && field.name) {
        if (field.name in result) {
          const value = result[field.name]
          result[field.name] = 'localized' in field && field.localized && localeMap(value)
            ? Object.fromEntries(Object.entries(value).map(([locale, entry]) => [locale, fieldValue(entry, field)]))
            : fieldValue(value, field)
        }
      } else if ('fields' in field) result = walk(result, field.fields) as Record<string, unknown>
    }
    return result
  }
  return walk(data, fields)
}
