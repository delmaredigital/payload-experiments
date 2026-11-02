import type { AdminViewProps } from 'payload'
import { redirect } from 'next/navigation.js'

export function CollectionListRedirect({ initPageResult }: Pick<AdminViewProps, 'initPageResult'>) {
  redirect(`${initPageResult.req.payload.config.routes.admin}/experiments`)
}
