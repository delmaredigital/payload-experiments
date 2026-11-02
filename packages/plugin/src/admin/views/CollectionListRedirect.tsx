import type { ListViewServerProps } from 'payload'
import { formatAdminURL } from 'payload/shared'
import { redirect } from 'next/navigation.js'

export function CollectionListRedirect({ payload }: Pick<ListViewServerProps, 'payload'>) {
  redirect(formatAdminURL({ adminRoute: payload.config.routes.admin, path: '/experiments' }))
}
