/** Path-only admin URLs, preserving Payload's root-route and trailing-slash behavior.
 * Source: Payload 3.90.2 utilities/formatAdminURL.ts (MIT).
 */
export function formatAdminURL({ adminRoute, path = '' }: { adminRoute: string; path?: string }) {
  const url = `${adminRoute === '/' ? '' : adminRoute.replace(/\/$/, '')}${path}` || '/'
  if (process.env.NEXT_TRAILING_SLASH !== 'true') return url
  const index = url.search(/[?#]/)
  const pathname = index === -1 ? url : url.slice(0, index)
  return pathname.endsWith('/') ? url : `${pathname}/${index === -1 ? '' : url.slice(index)}`
}
