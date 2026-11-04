import type { Block, Field, SanitizedConfig } from 'payload'

/** Payload keeps both inline definitions and slug references in blockReferences. */
export function contentBlocks(field: Extract<Field, { type: 'blocks' }>, blocks: Block[] = []): Block[] {
  return [...field.blocks, ...(field.blockReferences ?? []).flatMap(reference =>
    typeof reference === 'string' ? blocks.filter(block => block.slug === reference) : [reference])]
}

/** Any localized data makes a full-document publish unsafe in Payload 3.90. */
export function hasLocalizedFields(fields: Field[], config: Pick<SanitizedConfig, 'localization' | 'blocks'>, seen = new Set<Field>()): boolean {
  if (!config.localization) return false
  const blocks: Block[] = config.blocks ?? []
  return fields.some(field => {
    if (seen.has(field)) return false
    const branch = new Set(seen).add(field)
    if ('localized' in field && field.localized) return true
    if ('tabs' in field && field.tabs.some(tab => tab.localized || hasLocalizedFields(tab.fields, config, branch))) return true
    if ('fields' in field && hasLocalizedFields(field.fields, config, branch)) return true
    return field.type === 'blocks' && contentBlocks(field, blocks)
      .some(block => hasLocalizedFields(block.fields, config, branch))
  })
}
