import type { ContentReport } from './types/endpoints.js'

/** Every recorded content entry is updated or handled by the manager. */
export function contentDone(report: ContentReport | null | undefined): boolean {
  const docs = Array.isArray(report) ? report : report?.docs
  return Array.isArray(docs) && docs.length > 0 && docs.every(doc => doc?.ok === true || Boolean(doc?.dismissedAt))
}
