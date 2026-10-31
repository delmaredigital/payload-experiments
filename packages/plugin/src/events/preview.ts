import { XP_PREVIEW_PARAM } from '../constants.js'

/** These signals only suppress telemetry; they never authorize a preview or an assignment. */
export function isPreview(request: Request): boolean {
  if (new URL(request.url).searchParams.has(XP_PREVIEW_PARAM)) return true
  const referrer = request.headers.get('referer')
  try { if (referrer && new URL(referrer).searchParams.has(XP_PREVIEW_PARAM)) return true } catch { /* Ignore malformed referrers. */ }
  return (request.headers.get('cookie') ?? '').split(';').some(part => part.trim().startsWith('__prerender_bypass='))
}
