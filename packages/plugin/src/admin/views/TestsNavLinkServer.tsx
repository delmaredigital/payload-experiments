import { RenderServerComponent } from '@payloadcms/ui/elements/RenderServerComponent'
import type { ServerProps } from 'payload'
import { SURFACE_COPY } from '../copy/surface.js'
import { XP_TESTS_NAV_CLIENT } from '../paths.js'

type NavPreference = { groups?: Record<string, { open?: boolean }> }

export async function TestsNavLinkServer({ payload, user, permissions }: Pick<ServerProps, 'payload' | 'user' | 'permissions'>) {
  const testPermissions: { update?: boolean } | undefined = permissions?.collections?.['xp-experiments']
  if (!user?.collection || testPermissions?.update !== true) return null

  const result = await payload.find({
    collection: 'payload-preferences',
    where: { and: [
      { key: { equals: 'nav' } },
      { 'user.relationTo': { equals: user.collection } },
      { 'user.value': { equals: user.id } },
    ] },
    limit: 1,
    pagination: false,
    depth: 0,
    user,
    overrideAccess: false,
  })
  const value = result.docs[0]?.value as NavPreference | null | undefined

  // Resolve the CSS-bearing client boundary through Payload's public import map.
  return RenderServerComponent({
    Component: XP_TESTS_NAV_CLIENT,
    importMap: payload.importMap,
    clientProps: { isOpen: value?.groups?.[SURFACE_COPY.title]?.open ?? true },
  })
}
