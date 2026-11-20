/** Shared by server readiness checks and client placement lists. */
export const PLACEMENT_LANGUAGES = {
  allLocales: 'All languages',
  locales: (names: string) => `Languages: ${names}`,
} as const
