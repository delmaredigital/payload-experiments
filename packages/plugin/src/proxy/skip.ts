const ASSET_EXTENSION = /\.(?:js|mjs|css|map|png|jpg|jpeg|gif|webp|avif|svg|ico|woff|woff2|ttf|otf|eot|txt|xml|json|pdf|webmanifest|mp4|webm|mp3|wav)$/i

export function skipPath(path: string, apiRoute: string): boolean {
  const under = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`)
  const apiPrefix = apiRoute.replace(/\/+$/, '')
  // Only the last segment's extension counts, and only for known asset types: `/blog/v1.2`
  // and `/users/john.doe` are pages; a path ending in `.js` is treated as a script.
  const asset = ASSET_EXTENSION.test(path.slice(path.lastIndexOf('/') + 1))
  return under('/admin') || under('/_next') || (apiPrefix !== '' && under(apiPrefix)) || asset
}
