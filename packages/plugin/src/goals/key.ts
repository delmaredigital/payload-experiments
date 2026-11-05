/** Click keys are also metric slugs; keep the wire and field grammar identical. */
export const CLICK_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/
export const isClickSource = (source: unknown): source is string => typeof source === 'string' && source.startsWith('click:')
export const validClickSource = (source: unknown): source is string => isClickSource(source) && CLICK_KEY.test(source.slice(6))
