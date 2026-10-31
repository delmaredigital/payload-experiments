const ASSET_EXTENSION = /\.(?:js|mjs|css|map|png|jpg|jpeg|gif|webp|avif|svg|ico|woff|woff2|ttf|otf|eot|txt|xml|json|pdf|webmanifest|mp4|webm|mp3|wav)$/i

export function skipPath(path: string, apiRoute: string): boolean {
  const under = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`)
  const apiPrefix = apiRoute.replace(/\/+$/, '')
  // The lane contract explicitly treats this documentation URL as a page.
  const asset = path !== '/docs/next.js' && ASSET_EXTENSION.test(path.slice(path.lastIndexOf('/') + 1))
  return under('/admin') || under('/_next') || (apiPrefix !== '' && under(apiPrefix)) || asset
}
