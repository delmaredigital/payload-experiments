/** Only advisory metadata reads carry the content language. */
export const contentLocaleURL = (url: string, contentLocale?: string) => `${url}${contentLocale ? `?${new URLSearchParams({ locale: contentLocale })}` : ''}`
