import type { ListViewServerProps } from 'payload'
import { createLocalReq } from 'payload'
import { formatAdminURL } from 'payload/shared'
import { headers } from 'next/headers.js'
import { redirect } from 'next/navigation.js'
import { surfaceUrls } from '../surfaceUrls.js'
import { buildSurfaceProps } from './buildSurfaceProps.js'
import { renderTestsSurface } from './renderTestsSurface.js'

export async function renderCollectionList({ payload, searchParams }: ListViewServerProps, route: 'home' | 'goals') {
  const requestHeaders = await headers()
  // Authentication, not an access-checked operation; host access callbacks need the full session user.
  const { user } = await payload.auth({ headers: requestHeaders })
  const adminRoute = payload.config.routes.admin
  if (!user) {
    const { login } = payload.config.admin.routes
    const currentPath = route === 'home' ? surfaceUrls.home(adminRoute, await searchParams) : surfaceUrls.goals(adminRoute, await searchParams)
    return redirect(formatAdminURL({ adminRoute, path: `${login}?redirect=${encodeURIComponent(currentPath)}` }))
  }
  const req = await createLocalReq({ user, req: { headers: requestHeaders } }, payload)
  return renderTestsSurface(req, await buildSurfaceProps({ req, route, searchParams }))
}
