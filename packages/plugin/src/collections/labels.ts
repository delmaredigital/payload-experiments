import type { PayloadRequest } from 'payload'

/** Payload labels may be translated strings or functions. Keep server entries dependency-safe. */
export function collectionLabel(label: unknown, slug: string, req: PayloadRequest): string {
  try {
    if (typeof label === 'function') {
      const value: unknown = label({ i18n: req.i18n, t: req.i18n.t })
      return typeof value === 'string' ? value : slug
    }
    if (typeof label === 'string') return label
    const translations: Record<string, unknown> = label && typeof label === 'object' ? label as Record<string, unknown> : {}
    return [translations[req.i18n?.language ?? 'en'], translations.en, ...Object.values(translations)].find((value): value is string => typeof value === 'string') ?? slug
  } catch { return slug }
}
