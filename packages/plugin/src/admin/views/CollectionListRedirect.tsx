import { surfaceUrls } from '../surfaceUrls.js'
import type { ListViewServerProps } from 'payload'
import { redirect } from 'next/navigation.js'

export function CollectionListRedirect({ payload }: Pick<ListViewServerProps, 'payload'>) {
  redirect(surfaceUrls.home(payload.config.routes.admin))
}
