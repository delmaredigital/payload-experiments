export function skipPath(path: string, apiRoute: string): boolean {
  const under = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`)
  return under('/admin') || under('/_next') || under(apiRoute.replace(/\/+$/, '')) || /\.[^/]+$/.test(path)
}
