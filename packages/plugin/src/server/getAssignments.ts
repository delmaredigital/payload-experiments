import type { ExperimentsServerRuntime } from '../types/runtime.js'
import type { Assignments } from '../types/assignments.js'
import { cache } from 'react'
import { headers, cookies } from 'next/headers.js'
import { XP_HEADER } from '../constants.js'
import { assign, fillFlagPoints, type AssignmentResult } from '../runtime/assign.js'
import { verifyUnitCookie } from '../runtime/cookie.js'
import { decodeAssignmentsHeader } from '../runtime/header.js'
import { verifyPreviewToken } from '../runtime/previewToken.js'
import { isBot } from '../runtime/bot.js'
import { consentFallback } from '../proxy/consentFallback.js'
import { normalisePath } from '../runtime/normalisePath.js'
import { controlAssignments } from '../proxy/control.js'
import type { Attributes, ExperimentsPluginOptions } from '../types/contracts.js'
import { emptyManifest, rememberManifest, serverManifest, suppressExposure } from './context.js'
import { serverRequest } from './request.js'
import { previewDraft } from './previewDraft.js'
import { verifiedHeaderRevision } from './headerRevision.js'
import type { Payload } from 'payload'

// The mutable cell lives in React's request cache, never a process-wide user cache.
const requestCell = cache((_runtime: object, _userId: string) => ({ value: undefined as Promise<Assignments> | undefined }))

export async function getAssignments<TUser extends { id: string | number } = { id: string | number }>(serverRuntime: ExperimentsServerRuntime<TUser>, opts?: { user?: TUser | null }): Promise<Assignments> {
  const key = opts?.user === undefined ? 'auto' : opts.user === null ? 'anonymous' : `user:${serverRuntime.userIdOf(opts.user)}`
  const cell = requestCell(serverRuntime, key)
  return cell.value ??= readAssignments(serverRuntime, opts?.user)
}

async function readAssignments<TUser extends { id: string | number }>(runtime: ExperimentsServerRuntime<TUser>, suppliedUser: TUser | null | undefined): Promise<Assignments> {
  const [incoming, jar] = await Promise.all([headers(), cookies()])
  const requestHeaders = new Headers(incoming)
  const proxy = runtime.proxyRuntime
  const { request, hasContext, consent } = serverRequest(requestHeaders, proxy.secrets)
  const visitorId = consent === false ? undefined : verifyUnitCookie(jar.get(proxy.cookie.name)?.value, proxy.secrets) ?? undefined
  let payload: Payload | undefined
  let payloadFailed = false
  try { payload = await runtime.getPayload() } catch {
    payloadFailed = true
    console.error('[payload-experiments] getPayload failed; serving non-exposable control')
  }
  const options = payload?.config?.custom?.xp as ExperimentsPluginOptions<TUser> | undefined
  let unit: { userId?: string; attributes: Attributes; sessionUnknown?: boolean } = { attributes: {} }
  try { unit = consent === false ? unit : await proxy.getUnit?.(request) ?? unit } catch {
    unit = { attributes: {}, sessionUnknown: true }
    console.error('[payload-experiments] getUnit failed; treating session as unknown')
  }
  let user = consent === false ? null : suppliedUser
  const canResolveUser = consent !== false && (suppliedUser !== undefined || Boolean(runtime.getUser))
  let userFailed = false
  const resolveUser = async () => {
    if (user !== undefined) return user
    try { user = await runtime.getUser?.() ?? null } catch {
      userFailed = true
      user = null
      console.error('[payload-experiments] getUser failed; suppressing exposures')
    }
    return user
  }
  const value = requestHeaders.get(XP_HEADER)
  // Consent-false proxy headers are signed without either identity.
  let headerUserId = visitorId ? unit.userId : undefined
  const authenticate = (userId?: string) => verifiedHeaderRevision(value, { secrets: proxy.secrets, visitorId, userId })
  let revision = authenticate(headerUserId)
  if (revision === null && visitorId && value && (runtime.getUser || suppliedUser)) {
    const resolved = await resolveUser()
    if (resolved) {
      const resolvedId = runtime.userIdOf(resolved)
      revision = authenticate(resolvedId)
      if (revision !== null) headerUserId = resolvedId
    }
  }
  const cached = await serverManifest(proxy)
  let manifest = cached ?? emptyManifest()
  // A cold miss has already spent its sole coldStartMs window. Do not wait again.
  if (cached && revision !== null && revision > manifest.revision) manifest = await serverManifest(proxy, true) ?? manifest
  const decoded = value && revision !== null ? decodeAssignmentsHeader(value, { secrets: proxy.secrets, visitorId, userId: headerUserId, manifest }) : null
  const mustResolveStaff = Boolean(options?.attributeKeys?.staff && (decoded?.sessionUnknown || unit.sessionUnknown))
  const needsUser = !decoded || decoded.deferred.length > 0 || mustResolveStaff || suppliedUser !== undefined
  if (needsUser && canResolveUser) await resolveUser()
  let attributes: Attributes = { ...unit.attributes }
  if (hasContext) attributes.path = normalisePath(request.nextUrl.pathname)
  else delete attributes.path
  if (needsUser && canResolveUser) {
    try {
      attributes = { ...attributes, ...runtime.attributesOf(user ?? null) } as Attributes
      if (hasContext) attributes.path = normalisePath(request.nextUrl.pathname)
      else delete attributes.path
    } catch { userFailed = true }
  }
  const userId = visitorId ? (user === undefined ? unit.userId : user ? runtime.userIdOf(user) : undefined) : undefined
  const context = {
    visitorId, userId, staff: decoded?.staff === true || unit.attributes.staff === true || attributes.staff === true,
    bot: decoded?.bot === true || isBot(requestHeaders.get('user-agent')),
    preview: decoded?.preview ?? false, sessionUnknown: needsUser && canResolveUser && !userFailed ? false : decoded?.sessionUnknown ?? unit.sessionUnknown ?? false,
    method: request.method,
  }
  let result: AssignmentResult
  if (payloadFailed) result = controlAssignments(manifest, context)
  else if (consent === false && !decoded) {
    try { result = consentFallback(manifest, attributes, context) } catch {
      console.error('[payload-experiments] consent fallback failed; serving non-exposable control')
      result = controlAssignments(manifest, context)
    }
  } else if (decoded) {
    result = { ...decoded, ...context, archivedWinners: { ...manifest.archivedWinners } }
    const slugs = new Set(hasContext ? decoded.deferred : [])
    if (visitorId && user !== undefined && userId !== headerUserId) {
      for (const e of manifest.experiments) if (e.unitType === 'user') slugs.add(e.slug)
    }
    if (visitorId && slugs.size && canResolveUser && !userFailed) {
      try {
        const resolved = assign(manifest, { visitorId, userId, sessionUnknown: context.sessionUnknown }, attributes, { ...context, now: Math.floor(Date.now() / 1000) })
        for (const slug of slugs) {
          result.bySlug[slug] = resolved.bySlug[slug] ?? controlAssignments(manifest, context).bySlug[slug]!
        }
      } catch { userFailed = true }
    }
  } else if (!visitorId || !hasContext) result = controlAssignments(manifest, context)
  else {
    try { result = assign(manifest, { visitorId, userId, sessionUnknown: context.sessionUnknown }, attributes, { ...context, now: Math.floor(Date.now() / 1000) }) } catch {
      console.error('[payload-experiments] assign failed; serving non-exposable control')
      result = controlAssignments(manifest, context)
    }
  }
  // Missing users left deferred by assign must still render explicit, safe control.
  const controls = controlAssignments(manifest, context)
  for (const experiment of manifest.experiments) {
    if (!result.bySlug[experiment.slug]) result.bySlug[experiment.slug] = controls.bySlug[experiment.slug]!
  }
  fillFlagPoints(result, manifest)
  for (const point of options?.flagPoints ?? []) if (!Object.hasOwn(result.flagPoints, point.id)) {
    result.flagPoints[point.id] = { arm: 'control', params: { ...point.defaultParams }, source: 'default', exposable: false }
  }
  const token = hasContext ? verifyPreviewToken(request.nextUrl.searchParams.get('xp_preview') ?? '', proxy.secrets) : null
  if (token && visitorId && payload) {
    const live = manifest.experiments.find(e => e.id === token.e && e.phase === token.p && e.arms.some(a => a.key === token.a))
    if (live) {
      result.preview = true
      result.bySlug[live.slug] = { slug: live.slug, experimentId: live.id, arm: token.a, phase: token.p, policy: live.exposurePolicy, exposable: false, source: 'preview' }
      fillFlagPoints(result, manifest)
    } else await previewDraft(payload, await resolveUser(), token, result, requestHeaders)
  }
  if (suppressExposure(result) || !hasContext || !visitorId || payloadFailed || userFailed || (mustResolveStaff && !runtime.getUser && suppliedUser === undefined)) {
    for (const assignment of Object.values(result.bySlug)) assignment.exposable = false
    for (const point of Object.values(result.flagPoints)) point.exposable = false
  }
  return rememberManifest(result, manifest)
}
