import type { NextRequest, NextResponse } from 'next/server'
import type { ExperimentsProxyRuntime } from '../types/runtime.js'
import type { Attributes } from '../types/contracts.js'
import type { Manifest } from '../types/manifest.js'
import { XP_HEADER } from '../constants.js'
import { createManifestCache } from '../manifest/cache.js'
import { assign, fillFlagPoints, type AssignmentResult } from '../runtime/assign.js'
import { isBot } from '../runtime/bot.js'
import { cookieAttributes, encodeUnitCookie, mintUnitId, verifyUnitCookie } from '../runtime/cookie.js'
import { encodeAssignmentsHeader } from '../runtime/header.js'
import { verifyPreviewToken } from '../runtime/previewToken.js'
import { pageRewrite } from './pageRewrite.js'
import { skipPath } from './skip.js'
import { controlAssignments } from './control.js'

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
  for (const name of [...requestHeaders.keys()]) if (name.startsWith('x-xp-')) requestHeaders.delete(name)
  if (skipPath(request.nextUrl.pathname, proxyRuntime.apiRoute)) return result

  let consent = false
  try { consent = proxyRuntime.cookie.consent?.(request) !== false } catch {
    console.error('[payload-experiments] consent failed; treating consent as false')
  }
  const name = proxyRuntime.cookie.name
  let visitorId = consent ? verifyUnitCookie(request.cookies.get(name)?.value, proxyRuntime.secrets) ?? undefined : undefined
  if (!consent) {
    const cookies = (requestHeaders.get('cookie') ?? '').split(';')
      .map(cookie => cookie.trim()).filter(cookie => cookie && cookie.split('=', 1)[0]?.trim() !== name)
    if (cookies.length) requestHeaders.set('cookie', cookies.join('; '))
    else requestHeaders.delete('cookie')
  } else if (!visitorId) {
    visitorId = mintUnitId()
    const value = encodeUnitCookie(visitorId, proxyRuntime.secrets)
    result.requestCookies.push({ name, value })
    result.setCookies.push({ name, value, ...cookieAttributes(proxyRuntime, { https: request.nextUrl.protocol === 'https:' }) })
    const cookies = (request.headers.get('cookie') ?? '').split(';')
      .map(cookie => cookie.trim()).filter(cookie => cookie && cookie.split('=', 1)[0] !== name)
    cookies.push(`${name}=${value}`)
    requestHeaders.set('cookie', cookies.join('; '))
  }

  let resolvedUnit: Awaited<ReturnType<NonNullable<ExperimentsProxyRuntime['getUnit']>>> = { attributes: {} }
  try { resolvedUnit = await proxyRuntime.getUnit?.(request) ?? resolvedUnit } catch {
    console.error('[payload-experiments] getUnit failed; treating session as unknown')
    resolvedUnit = { attributes: {}, sessionUnknown: true }
  }
  const { attributes: unitAttributes, sessionUnknown } = resolvedUnit
  const userId = consent ? resolvedUnit.userId : undefined
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
  const currentManifest: Manifest = manifest ?? { v: 1, revision: 0, experiments: [], flagDefaults: {}, archivedWinners: {}, archivedPages: {} }
  const context = {
    visitorId, userId, staff: attributes.staff === true, bot: isBot(request.headers.get('user-agent')),
    preview: Boolean(previewExperiment), sessionUnknown: sessionUnknown ?? false, method: request.method,
  }
  let assignments: AssignmentResult
  let assignmentFailed = false
  try {
    assignments = assign(currentManifest, { visitorId, userId, sessionUnknown }, attributes, { ...context, now })
  } catch {
    console.error('[payload-experiments] assign failed; serving non-exposable control')
    assignmentFailed = true
    assignments = controlAssignments(currentManifest, context)
  }
  if (!consent) assignments = controlAssignments(currentManifest, context)
  if (previewExperiment && token) {
    if (consent && !assignmentFailed) {
      assignments.deferred = assignments.deferred.filter(slug => slug !== previewExperiment.slug)
      assignments.bySlug[previewExperiment.slug] = {
        slug: previewExperiment.slug, experimentId: previewExperiment.id, arm: token.a, phase: previewExperiment.phase,
        exposable: false, policy: previewExperiment.exposurePolicy, source: 'preview',
      }
      fillFlagPoints(assignments, currentManifest)
    }
    result.responseHeaders = new Headers({ 'Cache-Control': 'no-store' })
  }
  if (manifest && consent && !assignmentFailed) result.rewrite = pageRewrite(manifest, assignments, request.nextUrl)
  try {
    requestHeaders.set(XP_HEADER, encodeAssignmentsHeader(assignments, { secrets: proxyRuntime.secrets, manifest: manifest ?? undefined }))
  } catch {
    // The server recomputes from the signed cookie. Overflow loses preview forcing
    // and deferred/unresolvable-page control! overrides (CORE-07 handles recompute).
    // Consent refusal stays safe because its cookie was removed before forwarding.
  }
  return result
}
