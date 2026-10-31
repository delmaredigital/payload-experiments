import type { Slot } from '../../types/puck.js'

let sequence = 0

function freshId(type: string, used: Set<string>): string {
  let random: string
  try {
    const bytes = new Uint32Array(4)
    globalThis.crypto.getRandomValues(bytes)
    random = Array.from(bytes, byte => byte.toString(36)).join('')
  } catch {
    random = Math.random().toString(36).slice(2)
  }
  let id: string
  do { id = `${type}-${random}${(++sequence).toString(36)}` } while (used.has(id))
  used.add(id)
  return id
}

/** Clone JSON Puck slot data, refreshing component ids even inside nested slots. */
export function cloneSlot(slot: Slot): Slot {
  const used = new Set<string>()
  function collect(value: unknown): void {
    if (!value || typeof value !== 'object') return
    if ('id' in value && typeof value.id === 'string') used.add(value.id)
    Object.values(value).forEach(collect)
  }
  collect(slot)
  function clone(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(clone)
    if (!value || typeof value !== 'object') return value
    const source = value as Record<string, unknown>
    const result = Object.fromEntries(Object.entries(source).map(([key, entry]) => [key, clone(entry)]))
    if (typeof source.type === 'string' && result.props && typeof result.props === 'object') {
      const props = result.props as Record<string, unknown>
      props.id = freshId(source.type, used)
    }
    return result
  }
  return clone(slot) as Slot
}
