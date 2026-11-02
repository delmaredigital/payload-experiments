import type { AdminViewProps } from 'payload'
import { redirect } from 'next/navigation.js'

type Props = Pick<AdminViewProps, 'initPageResult' | 'params' | 'docID'> & { routeSegments?: string[] }
export async function CollectionEditRedirect({ initPageResult, params, routeSegments, docID }: Props) {
  const resolved = await params
  const segments = routeSegments ?? (Array.isArray(resolved?.segments) ? resolved.segments : [])
  const collectionIndex = segments.indexOf('xp-experiments')
  const tail = collectionIndex >= 0 ? segments.slice(collectionIndex + 1) : segments
  const id = tail[0] ?? resolved?.id ?? docID ?? initPageResult.docID
  const base = `${initPageResult.req.payload.config.routes.admin}/experiments`
  if (id === undefined || id === 'create') return redirect(`${base}/new`)
  return redirect(`${base}/${encodeURIComponent(String(id))}${tail[1] === 'results' ? '/results' : ''}`)
}
