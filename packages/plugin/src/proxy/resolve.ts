import type { NextRequest, NextResponse } from 'next/server'
import type { ExperimentsProxyRuntime } from '../types/runtime.js'
import type { Attributes } from '../types/contracts.js'
import { XP_HEADER } from '../constants.js'
import { createManifestCache } from '../manifest/cache.js'
import { assign, fillFlagPoints } from '../runtime/assign.js'
import { isBot } from '../runtime/bot.js'
import { cookieAttributes, encodeUnitCookie, mintUnitId, verifyUnitCookie } from '../runtime/cookie.js'
import { encodeAssignmentsHeader } from '../runtime/header.js'
import { verifyPreviewToken } from '../runtime/previewToken.js'
import { pageRewrite } from './pageRewrite.js'
import { skipPath } from './skip.js'

const caches = new WeakMap<ExperimentsProxyRuntime, ReturnType<typeof createManifestCache>>()

export interface ExperimentsProxyResult {
  responseHeaders?: Headers
  requestHeaders: Headers
  requestCookies: Array<{ name: string; value: string }>
  setCookies: Array<Exclude<Parameters<NextResponse['cookies']['set']>[0], string>>
  rewrite?: URL
}

export async function resolveExperiments(request: NextRequest, proxyRuntime: ExperimentsProxyRuntime): Promise<ExperimentsProxyResult> {
  const requestHeaders = new Headers(request.headers)
  const result: ExperimentsProxyResult = { requestHeaders, requestCookies: [], setCookies: [] }
  if (skipPath(request.nextUrl.pathname, proxyRuntime.apiRoute)) return result
  for (const name of [...requestHeaders.keys()]) if (name.startsWith('x-xp-')) requestHeaders.delete(name)

  let visitorId = verifyUnitCookie(request.cookies.get(proxyRuntime.cookie.name)?.value, proxyRuntime.secrets) ?? undefined
  if (!visitorId && proxyRuntime.cookie.consent?.(request) !== false) {
    visitorId = mintUnitId()
    const value = encodeUnitCookie(visitorId, proxyRuntime.secrets)
    const name = proxyRuntime.cookie.name
    result.requestCookies.push({ name, value })
    result.setCookies.push({ name, value, ...cookieAttributes(proxyRuntime, { https: request.nextUrl.protocol === 'https:' }) })
    const cookies = (request.headers.get('cookie') ?? '').split(';')
      .map(cookie => cookie.trim()).filter(cookie => cookie && cookie.split('=', 1)[0] !== name)
    cookies.push(`${name}=${value}`)
    requestHeaders.set('cookie', cookies.join('; '))
  }

  const { userId, attributes: unitAttributes, sessionUnknown } = await proxyRuntime.getUnit?.(request) ?? { attributes: {} }
  const attributes: Attributes = { ...unitAttributes, path: request.nextUrl.pathname }
  let cache = caches.get(proxyRuntime)
  if (!cache && proxyRuntime.loadManifest) {
    cache = createManifestCache(proxyRuntime.loadManifest)
    caches.set(proxyRuntime, cache)
  }
  const manifest = await cache?.get() ?? null
  const now = Math.floor(Date.now() / 1000)
  const token = verifyPreviewToken(request.nextUrl.searchParams.get('xp_preview') ?? '', proxyRuntime.secrets, now)
  const previewExperiment = token && manifest?.experiments.find(experiment => experiment.id === token.e
    && experiment.phase === token.p && (experiment.status === 'running' || experiment.status === 'decided')
    && experiment.arms.some(arm => arm.key === token.a))
  const assignments = assign(manifest ?? { v: 1, revision: 0, experiments: [], flagDefaults: {}, archivedWinners: {}, archivedPages: {} },
    { visitorId, userId, sessionUnknown }, attributes,
    { staff: attributes.staff === true, bot: isBot(request.headers.get('user-agent')), preview: Boolean(previewExperiment), sessionUnknown, method: request.method, now })
  if (previewExperiment && token) {
    assignments.deferred = assignments.deferred.filter(slug => slug !== previewExperiment.slug)
    assignments.bySlug[previewExperiment.slug] = {
      slug: previewExperiment.slug, experimentId: previewExperiment.id, arm: token.a, phase: previewExperiment.phase,
      exposable: false, policy: previewExperiment.exposurePolicy, source: 'preview',
    }
    fillFlagPoints(assignments, manifest!)
    result.responseHeaders = new Headers({ 'Cache-Control': 'no-store' })
  }
  if (manifest) result.rewrite = pageRewrite(manifest, assignments, new URL(request.url))
  try {
    requestHeaders.set(XP_HEADER, encodeAssignmentsHeader(assignments, { secrets: proxyRuntime.secrets, manifest: manifest ?? undefined }))
  } catch {
    // Over-budget headers are deliberately omitted; the server recomputes from the signed cookie.
  }
  return result
}
