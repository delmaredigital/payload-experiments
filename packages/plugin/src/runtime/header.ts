import { createHash } from 'node:crypto'
import type { Assignments } from '../types/assignments.js'
import type { Manifest } from '../types/manifest.js'
import { fillFlagPoints, type AssignmentResult } from './assign.js'
import { sign, verify } from './signing.js'

const MAX_BYTES = 1024
const SLUG = /^[A-Za-z0-9_-]+$/
const ARM = /^(control|variantA|variantB|variantC|holdout)$/
const slugHash = (slug: string) => `#${createHash('sha256').update(slug).digest('hex').slice(0, 8)}`
const message = (visitorId: string | undefined, userId: string | undefined, flags: string, entries: string, revision: string) => `${visitorId ?? ''}|${userId ?? ''}|${flags}|${entries}|${revision}`

export function encodeAssignmentsHeader(assignments: Assignments & { deferred?: readonly string[] }, opts: { secrets: readonly string[]; manifest?: Manifest }): string {
  if (!Number.isSafeInteger(assignments.revision) || assignments.revision < 0) throw new Error('Invalid revision')
  const flags = `${assignments.staff ? 's' : ''}${assignments.bot ? 'b' : ''}${assignments.preview ? 'p' : ''}${assignments.sessionUnknown ? 'u' : ''}`
  const slugs = [...Object.keys(assignments.bySlug), ...assignments.deferred ?? []]
  if (new Set(slugs).size !== slugs.length || slugs.some(slug => !SLUG.test(slug))) throw new Error('Invalid or duplicate slug')
  for (const entry of Object.values(assignments.bySlug)) if (!ARM.test(entry.arm)) throw new Error('Invalid arm')
  const encode = (hashed: boolean) => {
    const entries = [
      ...Object.entries(assignments.bySlug).map(([slug, entry]) => `${hashed ? slugHash(slug) : slug}=${entry.arm}${entry.exposable ? '' : '!'}`),
      ...(assignments.deferred ?? []).map(slug => `?${hashed ? slugHash(slug) : slug}`),
    ].join(';')
    const revision = String(assignments.revision)
    return `v1.${revision}.${flags}.${entries}.${sign(message(assignments.visitorId, assignments.userId, flags, entries, revision), opts.secrets)}`
  }
  const plain = encode(false)
  if (Buffer.byteLength(plain) <= MAX_BYTES) return plain
  const hashes = (opts.manifest?.experiments.map(experiment => experiment.slug) ?? slugs).map(slugHash)
  if (new Set(hashes).size !== hashes.length) throw new Error('Ambiguous slug hash')
  const hashed = encode(true)
  if (Buffer.byteLength(hashed) > MAX_BYTES) throw new RangeError('Assignments header exceeds 1024 bytes')
  return hashed
}

export function decodeAssignmentsHeader(value: string, opts: { secrets: readonly string[]; visitorId?: string; userId?: string; manifest: Manifest }): AssignmentResult | null {
  if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_BYTES) return null
  const parts = value.split('.')
  if (parts.length !== 5) return null
  const [version, revision, flags, entries, mac] = parts as [string, string, string, string, string]
  if (version !== 'v1' || !/^(0|[1-9]\d*)$/.test(revision) || !Number.isSafeInteger(Number(revision))) return null
  // Phase and policy are reconstructed from this exact manifest, never a different revision.
  if (Number(revision) !== opts.manifest.revision) return null
  if (!/^[sbpu]*$/.test(flags) || new Set(flags).size !== flags.length) return null
  if (!verify(message(opts.visitorId, opts.userId, flags, entries, revision), mac, opts.secrets)) return null
  const manifestBySlug = new Map(opts.manifest.experiments.map(experiment => [experiment.slug, experiment]))
  const hashes = new Map<string, string | null>()
  for (const experiment of opts.manifest.experiments) {
    const key = slugHash(experiment.slug)
    hashes.set(key, hashes.has(key) ? null : experiment.slug)
  }
  const result: AssignmentResult = {
    revision: Number(revision), visitorId: opts.visitorId, userId: opts.userId,
    staff: flags.includes('s'), bot: flags.includes('b'), preview: flags.includes('p'), sessionUnknown: flags.includes('u'),
    bySlug: Object.create(null), flagPoints: Object.create(null), archivedWinners: { ...opts.manifest.archivedWinners }, deferred: [], method: 'GET',
  }
  const seen = new Set<string>()
  for (const entry of entries ? entries.split(';') : []) {
    const match = /^(\?)?([A-Za-z0-9_-]+|#[a-f0-9]{8})(?:=(control|variantA|variantB|variantC|holdout)(!)?)?$/.exec(entry)
    if (!match) return null
    const [, deferred, key, arm, nonExposable] = match
    if (Boolean(deferred) === Boolean(arm)) return null
    const slug = key!.startsWith('#') ? hashes.get(key!) : key
    if (!slug || seen.has(slug)) return null
    const experiment = manifestBySlug.get(slug)
    if (!experiment) return null
    seen.add(slug)
    if (deferred) { result.deferred.push(slug); continue }
    if (!experiment.arms.some(candidate => candidate.key === arm)) return null
    result.bySlug[slug] = {
      slug, experimentId: experiment.id, arm: arm!, phase: experiment.phase, policy: experiment.exposurePolicy,
      exposable: !nonExposable && !result.staff && !result.bot && !result.preview, source: 'header',
    }
  }
  fillFlagPoints(result, opts.manifest)
  return result
}
