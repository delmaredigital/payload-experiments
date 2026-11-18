/** payload-puck's stored visibility contract. No runtime dependency on the host plugin. */
export const visibilitySizes = ['phone', 'tablet', 'desktop'] as const
export type VisibilitySize = typeof visibilitySizes[number]
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** Read known sizes only; missing lists and malformed entries add no hiding. */
export function hiddenOnSizes(value: unknown): VisibilitySize[] {
  if (!object(value) || !Array.isArray(value.hideOn)) return []
  const sizes = value.hideOn
  return visibilitySizes.filter(size => sizes.includes(size))
}
export function fullyHidden(value: unknown): boolean {
  return object(value) && (value.hidden === true || hiddenOnSizes(value).length === visibilitySizes.length)
}

export type BlockVisibility = { hidden: boolean; hideOn: VisibilitySize[] }
type PuckBlock = Record<string, unknown> & { type: string; props: Record<string, unknown> }

/** Visit blocks with their ancestors' visibility, including legacy owner-id:zone edges.
 * Orphan zones retain their historical discovery behavior and count as shown.
 */
export function walkVisiblePuck(data: unknown, visit: (block: PuckBlock, visibility: BlockVisibility) => void): void {
  const owners = new Set<string>()
  const zones = new Map<string, unknown[]>()
  const roots: Array<{ owner: string; content: unknown }> = []
  function index(value: unknown) {
    if (Array.isArray(value)) { value.forEach(index); return }
    if (!object(value)) return
    if (typeof value.type === 'string' && object(value.props) && typeof value.props.id === 'string') owners.add(value.props.id)
    for (const [key, child] of Object.entries(value)) {
      if (value === data && key === 'zones' && object(child)) {
        for (const [zone, content] of Object.entries(child)) {
          const owner = zone.slice(0, zone.lastIndexOf(':'))
          zones.set(owner, [...(zones.get(owner) ?? []), content])
          roots.push({ owner, content })
          index(content)
        }
      } else index(child)
    }
  }
  index(data)
  const seen = new WeakSet<object>()
  function walk(value: unknown, inherited: BlockVisibility) {
    if (Array.isArray(value)) { value.forEach(child => walk(child, inherited)); return }
    if (!object(value) || seen.has(value)) return
    seen.add(value)
    let visibility = inherited
    const props = value.props
    if (typeof value.type === 'string' && object(props)) {
      visibility = { hidden: inherited.hidden || fullyHidden(props._visibility),
        hideOn: visibilitySizes.filter(size => inherited.hideOn.includes(size) || hiddenOnSizes(props._visibility).includes(size)) }
      visit(value as PuckBlock, visibility)
      if (typeof props.id === 'string') for (const content of zones.get(props.id) ?? []) walk(content, visibility)
    }
    for (const [key, child] of Object.entries(value)) if (value !== data || key !== 'zones' || !object(child)) walk(child, visibility)
  }
  const shown: BlockVisibility = { hidden: false, hideOn: [] }
  walk(data, shown)
  for (const root of roots) if (!owners.has(root.owner)) walk(root.content, shown)
}

/** Identity-keyed index shared by discovery and the public resolver. */
export function puckVisibility(data: unknown): Map<object, BlockVisibility> {
  const result = new Map<object, BlockVisibility>()
  walkVisiblePuck(data, (block, visibility) => result.set(block, visibility))
  return result
}
