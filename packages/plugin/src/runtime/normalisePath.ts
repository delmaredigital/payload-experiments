/** Normalise a pathname only: preserve root and percent encoding. */
export function normalisePath(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/'
}
