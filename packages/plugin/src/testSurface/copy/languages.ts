/** Shared by server readiness checks and client placement lists. */
export const PLACEMENT_LANGUAGES = {
  allLocales: 'All languages',
  locales: (names: string) => `Languages: ${names}`,
} as const

export interface PlacementLanguages { locales?: readonly string[]; allLocales?: boolean }
/** Shared suffix for server findings, placement rows, and delete-impact details. */
export function placementLanguageSuffix({ locales, allLocales }: PlacementLanguages): string {
  return allLocales ? ` · ${PLACEMENT_LANGUAGES.allLocales}` : locales?.length ? ` · ${PLACEMENT_LANGUAGES.locales(locales.join(', '))}` : ''
}
