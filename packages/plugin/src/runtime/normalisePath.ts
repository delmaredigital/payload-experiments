/** Normalise a pathname only: preserve root and percent encoding. */
export function normalisePath(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/'
}

/** Match own path keys with the same rules as live page targets. */
export function findNormalisedPathKey<T>(paths: Readonly<Record<string, T>>, pathname: string): string | undefined {
  const path = normalisePath(pathname)
  return Object.keys(paths).find(key => normalisePath(key) === path)
}
