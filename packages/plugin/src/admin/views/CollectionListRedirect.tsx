import { formatAdminURL } from 'payload/shared'
import type { ListViewServerProps } from 'payload'
import { redirect } from 'next/navigation.js'

/** @deprecated Retained for existing import maps until 0.5.0. */
export function CollectionListRedirect({ payload }: Pick<ListViewServerProps, 'payload'>) {
  redirect(formatAdminURL({ adminRoute: payload.config.routes.admin, path: '/experiments' }))
}
