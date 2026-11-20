import { getTranslation } from '@payloadcms/translations'
import type { PayloadRequest } from 'payload'

/** One language naming rule for placement lists and visitor-impact details. */
export function placementLanguages(req: PayloadRequest, codes: readonly string[]): { locales?: string[]; allLocales?: true } {
  const localization = req.payload.config.localization
  const unique = [...new Set(codes.filter(Boolean))]
  if (localization && unique.length === localization.localeCodes.length) return { allLocales: true }
  const locales = unique.map(code => {
    const label = localization && localization.locales.find(entry => entry.code === code)?.label
    return label ? getTranslation(label, req.i18n ?? { language: 'en', fallbackLanguage: 'en' } as PayloadRequest['i18n']) || code : code
  })
  return locales.length ? { locales } : {}
}
