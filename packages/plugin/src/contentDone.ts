import type { ContentReport } from './types/endpoints.js'

/** Every recorded content entry is updated or handled by the manager. A present but empty report is done:
 * page tests and flag tests without a host callback record no entries. An absent report is not done. */
export function contentDone(report: ContentReport | null | undefined): boolean {
  const docs = Array.isArray(report) ? report : report?.docs
  return Array.isArray(docs) && docs.every(doc => doc?.ok === true || Boolean(doc?.dismissedAt))
}
