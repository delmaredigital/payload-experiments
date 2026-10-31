import { createHash } from 'node:crypto'
import { expect, test } from 'vitest'
import { assign, type AssignmentResult } from '../../src/runtime/assign.js'
import { decodeAssignmentsHeader, encodeAssignmentsHeader } from '../../src/runtime/header.js'
import { sign, verify } from '../../src/runtime/signing.js'
import { encodeUnitCookie, verifyUnitCookie } from '../../src/runtime/cookie.js'
import { signPreviewToken, verifyPreviewToken } from '../../src/runtime/previewToken.js'
import type { Manifest } from '../../src/types/manifest.js'

const manifest: Manifest = {
  v: 1, revision: 4, archivedWinners: { old: 'variantA' }, archivedPages: {}, flagDefaults: {},
  experiments: [{
    id: 'experiment', slug: 'hero-test', kind: 'flag', flagPoint: 'hero', unitType: 'visitor', status: 'running',
    phase: 2, phaseKind: 'test', seed: '0123456789abcdef0123456789abcdef|', coverage: 1,
    arms: [{ key: 'control', kind: 'control', weight: 50, params: { title: 'Original' } }, { key: 'variantA', kind: 'variant', weight: 50, params: { title: 'New' } }],
    targeting: [], exposurePolicy: 'manual', deferrable: false,
  }],
}
const secrets = ['new', 'old']
const result = () => assign(manifest, { visitorId: 'visitor', userId: 'user' }, {}, { now: 0 })
const decode = (value: string, m = manifest) => decodeAssignmentsHeader(value, { secrets, visitorId: 'visitor', userId: 'user', manifest: m })

test('wire round trip binds ids, revision and entries; derives trusted metadata from manifest', () => {
  const original = result(), value = encodeAssignmentsHeader(original, { secrets: ['old'] })
  expect(value).toMatch(/^v1\.4\.\.hero-test=(control|variantA)\.[A-Za-z0-9_-]{43}$/)
  const decoded = decode(value)!
  expect(decoded).toEqual({ ...original, bySlug: { 'hero-test': { ...original.bySlug['hero-test'], source: 'header' } } })
  expect(decoded.flagPoints.hero?.experimentId).toBe('experiment')
  expect(decodeAssignmentsHeader(value, { secrets: ['wrong'], visitorId: 'visitor', userId: 'user', manifest })).toBeNull()
})
test.each(['staff', 'bot', 'preview', 'sessionUnknown'] as const)('every flag is signed and decoded: %s', flag => {
  const original = result()
  original[flag] = true
  const decoded = decode(encodeAssignmentsHeader(original, { secrets }))!
  expect(decoded[flag]).toBe(true)
  if (flag !== 'sessionUnknown') {
    expect(decoded.bySlug['hero-test']?.exposable).toBe(false)
    expect(decoded.flagPoints.hero?.exposable).toBe(false)
  }
})
test('all flags, non-exposable ! and deferred ? entries round trip', () => {
  const m = { ...manifest, experiments: [...manifest.experiments, { ...manifest.experiments[0]!, id: 'other', slug: 'deferred', flagPoint: undefined }] }
  const original = result()
  original.bySlug['hero-test']!.exposable = false
  Object.assign(original, { staff: true, bot: true, preview: true, sessionUnknown: true, deferred: ['deferred'] })
  const value = encodeAssignmentsHeader(original, { secrets })
  expect(value).toContain('.sbpu.hero-test=')
  expect(value).toContain('!;?deferred.')
  expect(decode(value, m)).toMatchObject({ staff: true, bot: true, preview: true, sessionUnknown: true, deferred: ['deferred'] })
  expect(decode(value, m)?.bySlug.deferred).toBeUndefined()
})
test('40 long experiment slugs hash to eight SHA256 hex digits and stay within 1024 bytes', () => {
  const m = { ...manifest, experiments: Array.from({ length: 40 }, (_, i) => ({ ...manifest.experiments[0]!, id: String(i), slug: `long-experiment-name-for-header-compression-${i}`, flagPoint: undefined })) }
  const original = assign(m, { visitorId: 'visitor', userId: 'user' }, {}, { now: 0 })
  // Include both deferred and non-exposable entries in the compressed format.
  original.deferred.push(m.experiments[0]!.slug)
  delete original.bySlug[m.experiments[0]!.slug]
  original.bySlug[m.experiments[1]!.slug]!.exposable = false
  const value = encodeAssignmentsHeader(original, { secrets, manifest: m })
  expect(Buffer.byteLength(value)).toBeLessThanOrEqual(1024)
  expect(value).toContain(`#${createHash('sha256').update(m.experiments[0]!.slug).digest('hex').slice(0, 8)}`)
  expect(value).not.toContain('long-experiment-name')
  const decoded = decode(value, m)!
  expect(Object.keys(decoded.bySlug)).toHaveLength(39)
  expect(decoded.deferred).toEqual(original.deferred)
  for (const [slug, entry] of Object.entries(original.bySlug)) expect(decoded.bySlug[slug]).toEqual({ ...entry, source: 'header' })
  expect(decode(value, { ...m, experiments: [...m.experiments, m.experiments[0]!] })).toBeNull()
})
test('tampering with entries, revision, flags, ids or version and truncation fails closed', () => {
  const value = encodeAssignmentsHeader(result(), { secrets })
  for (const changed of [value.replace('.4.', '.5.'), value.replace('hero-test=', 'unknown='), value.replace('.4..', '.4.s.'), value.replace('v1.', 'v2.'), value.slice(0, -1), `${value}.extra`, 'x'.repeat(1025)]) expect(decode(changed)).toBeNull()
  const parts = value.split('.')
  parts[3] = parts[3]!.replace(/=(control|variantA)/, '=holdout')
  expect(decode(parts.join('.'))).toBeNull()
  for (const ids of [{ visitorId: 'attacker', userId: 'user' }, { visitorId: 'visitor', userId: 'attacker' }, {}]) expect(decodeAssignmentsHeader(value, { secrets, manifest, ...ids })).toBeNull()
})
test('signed malformed entries, unknown arms, duplicates and invalid flags are rejected', () => {
  const wire = (entries: string, flags = '', revision = '4') => `v1.${revision}.${flags}.${entries}.${sign(`xp:assign:visitor|user|${flags}|${entries}|${revision}`, secrets)}`
  for (const entries of ['hero-test=unknown', 'hero-test=holdout', '?hero-test=control', 'hero-test', 'hero-test=control;hero-test=variantA', '?hero-test;hero-test=control', 'hero-test=control;', '?missing', '#12345678=control', 'hero-test=control!!']) expect(decode(wire(entries))).toBeNull()
  for (const flags of ['x', 'ss', 'suus']) expect(decode(wire('hero-test=control', flags))).toBeNull()
  for (const revision of ['04', '-1', 'NaN', '9007199254740992']) expect(decode(wire('hero-test=control', '', revision))).toBeNull()
  const empty: AssignmentResult = { ...result(), bySlug: {}, flagPoints: {} }
  expect(decode(encodeAssignmentsHeader(empty, { secrets }))?.bySlug).toEqual({})
})
test('encoder refuses ambiguous, invalid or unrepresentably large headers', () => {
  const duplicate = result()
  duplicate.deferred = ['hero-test']
  expect(() => encodeAssignmentsHeader(duplicate, { secrets })).toThrow('duplicate')
  const original = result(), entry = original.bySlug['hero-test']!
  original.bySlug = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`experiment-long-slug-${i}`, entry]))
  expect(() => encodeAssignmentsHeader(original, { secrets })).toThrow('1024')
})
test('a valid header from a different manifest revision cannot acquire the wrong phase metadata', () => {
  const value = encodeAssignmentsHeader(result(), { secrets })
  for (const revision of [3, 5]) {
    const m = { ...manifest, revision, experiments: manifest.experiments.map(e => ({ ...e, phase: 99 })) }
    expect(decode(value, m)).toBeNull()
  }
})
test('prototype-key slugs and flag points survive the wire as own entries', () => {
  const m = { ...manifest, experiments: [{ ...manifest.experiments[0]!, slug: '__proto__', flagPoint: '__proto__' }] }
  const original = assign(m, { visitorId: 'visitor', userId: 'user' }, {}, { now: 0 })
  const value = encodeAssignmentsHeader(original, { secrets })
  expect(value).toContain('__proto__=')
  const decoded = decode(value, m)!
  expect(Object.keys(decoded.bySlug)).toEqual(['__proto__'])
  expect(Object.keys(decoded.flagPoints)).toEqual(['__proto__'])
  expect(decoded.bySlug.__proto__).toEqual({ ...original.bySlug.__proto__, source: 'header' })
})
test('header MACs use their own domain and cannot authenticate cookies or previews', () => {
  const value = encodeAssignmentsHeader(result(), { secrets })
  const [, revision, flags, entries, mac] = value.split('.')
  const payload = `visitor|user|${flags}|${entries}|${revision}`
  expect(mac).toBe(sign(`xp:assign:${payload}`, secrets))
  expect(verify(`xp:unit:${payload}`, mac!, secrets)).toBe(false)
  expect(verify(`xp:preview:${payload}`, mac!, secrets)).toBe(false)
  const now = 1_800_000_000
  const preview = signPreviewToken({ e: 'experiment', a: 'variantA', p: 1, exp: now + 3600 }, secrets, now)
  const body = preview.split('.')[0]!
  expect(verifyUnitCookie(`${body}.${mac}`, secrets)).toBeNull()
  expect(verifyPreviewToken(`${body}.${mac}`, secrets, now)).toBeNull()
  for (const replacement of [sign(payload, secrets), preview.split('.')[1], encodeUnitCookie(body, secrets).split('.')[1]]) {
    expect(decode(`v1.${revision}.${flags}.${entries}.${replacement}`)).toBeNull()
  }
})
