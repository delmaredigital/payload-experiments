import { sanitizeFallbackLocale, type PayloadRequest } from 'payload'

/** Validate advisory-read metadata language; placement discovery still scans all languages. */
export function contentLocale(req: PayloadRequest) {
  const localization = req.payload.config.localization
  const requested = new URL(req.url ?? 'http://xp.invalid').searchParams.get('locale') ?? req.locale
  const locale = localization ? localization.localeCodes.includes(requested ?? '') ? requested : localization.defaultLocale : undefined
  const fallbackLocale = localization ? sanitizeFallbackLocale({ fallbackLocale: req.fallbackLocale ?? null, locale: locale!, localization }) : req.fallbackLocale
  return { locale, fallbackLocale }
}
