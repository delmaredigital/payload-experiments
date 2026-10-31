import type { Attributes } from '../types/contracts.js'

/** Normalise a pathname only: preserve root and percent encoding. */
export function normalisePath(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/'
}

/** Match own path keys with the same rules as live page targets. */
export function findNormalisedPathKey<T>(paths: Readonly<Record<string, T>>, pathname: string): string | undefined {
  const path = normalisePath(pathname)
  return Object.keys(paths).find(key => normalisePath(key) === path)
}

/** The attribute set targeting sees, shared by the proxy and the server: the unit's attributes plus the normalised path (removed when the path is unknown). */
export function requestAttributes(unit: Attributes, pathname: string | undefined): Attributes {
  const attributes: Attributes = { ...unit }
  if (pathname === undefined) delete attributes.path
  else attributes.path = normalisePath(pathname)
  return attributes
}
