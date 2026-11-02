import type { DocumentViewServerProps } from 'payload'
import { formatAdminURL } from 'payload/shared'
import { redirect } from 'next/navigation.js'

type Props = Pick<DocumentViewServerProps, 'initPageResult' | 'params' | 'routeSegments'>
export async function CollectionEditRedirect({ initPageResult, params, routeSegments }: Props) {
  const resolved = await params
  const segments = routeSegments ?? (Array.isArray(resolved?.segments) ? resolved.segments : [])
  const collectionIndex = segments.indexOf('xp-experiments')
  const tail = collectionIndex >= 0 ? segments.slice(collectionIndex + 1) : segments
  const id = tail[0] ?? resolved?.id ?? initPageResult.docID
  const path: `/${string}` = id === undefined || id === 'create' ? '/experiments/new'
    : `/experiments/${encodeURIComponent(String(id))}${tail[1] === 'results' ? '/results' : ''}`
  return redirect(formatAdminURL({ adminRoute: initPageResult.req.payload.config.routes.admin, path }))
}
