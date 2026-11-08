import { formatAdminURL } from 'payload/shared'

type SurfaceQuery = Record<string, string | string[] | undefined>
export function surfaceQuery(query: SurfaceQuery = {}): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) value.forEach(item => params.append(key, item))
    else if (value !== undefined) params.set(key, value)
  }
  return params.size ? `?${params}` : ''
}

export const surfaceUrls = {
  home: (adminRoute: string, query?: SurfaceQuery) => formatAdminURL({ adminRoute, path: `/collections/xp-experiments${surfaceQuery(query)}` }),
  goals: (adminRoute: string, query?: SurfaceQuery) => formatAdminURL({ adminRoute, path: `/collections/xp-metrics${surfaceQuery(query)}` }),
}
