import type { Field } from 'payload'
import { findRegisteredBlocksField } from '../../blocks/formState.js'
import { XP_TEST_BLOCK } from '../paths.js'

/** Copy the coordinates supplied by CORE-L2, including every containing array. */
export function injectTestBlock(fields: Field[], registration: { field: string; blockSlug?: string; appliesTo?: (doc: Record<string, unknown>) => boolean }): Field[] {
  const found = findRegisteredBlocksField(fields, registration.field)
  if (!found) return fields
  const ui: Field = { name: 'xpTestBlock', type: 'ui', admin: {
    condition: data => { try { return registration.appliesTo ? registration.appliesTo(data) === true : true } catch { return false } },
    components: { Field: { path: XP_TEST_BLOCK, clientProps: { blocksField: registration.field, blockSlug: registration.blockSlug } } },
  } }
  function insert(value: any, path: Array<string | number>): any {
    const [key, ...rest] = path
    if (key === undefined) return value
    const copy = Array.isArray(value) ? [...value] : { ...value }
    if (!rest.length) copy.splice(Number(key) + 1, 0, ui)
    else copy[key] = insert(value[key], rest)
    return copy
  }
  return insert(fields, found.path)
}
