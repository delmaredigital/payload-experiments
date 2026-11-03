import type { Block, Field } from 'payload'

/** Any localized data makes a full-document publish unsafe in Payload 3.90. */
export function hasLocalizedFields(fields: Field[], blocks: Block[] = [], seen = new Set<Field>()): boolean {
  return fields.some(field => {
    if (seen.has(field)) return false
    const branch = new Set(seen).add(field)
    if ('localized' in field && field.localized) return true
    if ('tabs' in field && field.tabs.some(tab => tab.localized || hasLocalizedFields(tab.fields, blocks, branch))) return true
    if ('fields' in field && hasLocalizedFields(field.fields, blocks, branch)) return true
    return field.type === 'blocks' && [...field.blocks, ...(field.blockReferences ?? []).flatMap(slug => blocks.filter(block => block.slug === slug))]
      .some(block => hasLocalizedFields(block.fields, blocks, branch))
  })
}
