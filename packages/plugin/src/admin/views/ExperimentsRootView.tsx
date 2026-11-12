import type { AdminViewServerProps } from 'payload'
import { formatAdminURL } from 'payload/shared'
import { notFound, redirect } from 'next/navigation.js'
import { xpOptionsFromReq } from '../../options/fromReq.js'
import type { TestsRoute } from '../../types/surface.js'
import { surfaceUrls } from '../../testSurface/surfaceUrls.js'
import { buildSurfaceProps } from './buildSurfaceProps.js'
import { renderTestsSurface } from './renderTestsSurface.js'

export async function ExperimentsRootView({ initPageResult, params, searchParams }: Pick<AdminViewServerProps, 'initPageResult' | 'params' | 'searchParams'>) {
  const { req } = initPageResult
  const adminRoute = req.payload.config.routes.admin
  const segments = (await params)?.segments
  const path = Array.isArray(segments) ? segments : []
  const tail = path[0] === 'experiments' ? path.slice(1) : path
  let route: TestsRoute
  let id: string | undefined
  if (tail.length === 0) route = 'home'
  else if (tail.length === 1 && tail[0] === 'new') route = 'new'
  else if (tail.length === 1 && tail[0] === 'goals') route = 'goals'
  else if (tail.length === 2 && tail[0] === 'goals') { route = tail[1] === 'new' ? 'goalNew' : 'goal'; if (route === 'goal') id = tail[1] }
  else if (tail.length === 1) { route = 'test'; id = tail[0] }
  else if (tail.length === 2 && tail[0] === 'by-slug') { route = 'test'; id = tail[1] }
  else if (tail.length === 2 && tail[1] === 'results') { route = 'results'; id = tail[0] }
  else return notFound()

  if (!req.user) {
    const { login } = req.payload.config.admin.routes
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(await searchParams ?? {})) {
      if (Array.isArray(value)) value.forEach(item => query.append(key, item))
      else if (value !== undefined) query.set(key, String(value))
    }
    const currentPath = formatAdminURL({ adminRoute,
      path: `/experiments${tail.length ? `/${tail.map(encodeURIComponent).join('/')}` : ''}${query.size ? `?${query}` : ''}` })
    return redirect(formatAdminURL({ adminRoute,
      path: `${login}?redirect=${encodeURIComponent(currentPath)}` }))
  }
  if (route === 'home' || route === 'goals') {
    let canManage = false
    try { canManage = await xpOptionsFromReq(req).access.manage({ req }) === true } catch { /* Deny failed access checks. */ }
    if (!canManage) return renderTestsSurface(req, null)
    return redirect(route === 'home' ? surfaceUrls.home(adminRoute, await searchParams) : surfaceUrls.goals(adminRoute, await searchParams))
  }
  const clientProps = await buildSurfaceProps({ req, route, id, searchParams })
  if (clientProps?.canManage && id && tail[0] === 'by-slug') {
    const result = await req.payload.find({ collection: 'xp-experiments', req, overrideAccess: false, depth: 0, limit: 1, where: { slug: { equals: id } } })
    if (!result.docs[0]) return notFound()
    clientProps.id = String(result.docs[0].id)
  }
  return renderTestsSurface(req, clientProps)
}
