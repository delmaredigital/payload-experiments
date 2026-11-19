/** Puck bindings use the documented object shape; plain strings are unbound. */
export function puckExperimentSlug(ref: unknown): string | undefined {
  return ref !== null && typeof ref === 'object' && 'slug' in ref && typeof ref.slug === 'string' ? ref.slug : undefined
}
