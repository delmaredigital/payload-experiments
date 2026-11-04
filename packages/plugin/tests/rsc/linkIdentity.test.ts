import type { Payload } from 'payload'
import { NextRequest } from 'next/server'
import { expect, test, vi } from 'vitest'
import { linkIdentity } from '../../src/server/linkIdentity.js'
import { encodeUnitCookie } from '../../src/runtime/cookie.js'
import { sign } from '../../src/runtime/signing.js'
import type { ExperimentsServerRuntime } from '../../src/types/runtime.js'

function fixture() {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
  const release = vi.fn()
  const connect = vi.fn().mockResolvedValue({ query, release })
  const transaction = vi.fn()
  const error = vi.fn()
  const runtime = { proxyRuntime: { secrets: ['new', 'old'], cookie: { name: 'custom_xp' } },
    getPayload: vi.fn().mockResolvedValue({ db: { pool: { connect }, schemaName: 'isolated', drizzle: { execute: transaction }, sessions: { caller: { db: { execute: transaction } } } }, logger: { error } } as unknown as Payload),
  } as unknown as ExperimentsServerRuntime
  return { runtime, query, connect, release, transaction, error }
}

test('duplicate signed cookies link the last visitor, matching the proxy', async () => {
  const { runtime, query } = fixture()
  const cookie = `custom_xp=${encodeUnitCookie('first', ['new'])}; custom_xp=${encodeUnitCookie('last', ['old'])}`
  await linkIdentity(runtime, { headers: new Headers({ cookie }), userId: 'user', verified: true })
  expect(query.mock.calls[0]![0]).toMatchObject({ values: ['last', 'user', true] })
})

test.each([undefined, 'visitor', encodeUnitCookie('visitor', ['wrong']), `visitor.${sign('visitor', ['new'])}`])('rejects absent/unsigned/tampered/old-format cookies (%s)', async cookie => {
  const { runtime, connect } = fixture()
  await expect(linkIdentity(runtime, { headers: new Headers(cookie ? { cookie: `custom_xp=${cookie}` } : {}), userId: 'user', verified: true })).resolves.toBe('skipped')
  expect(connect).not.toHaveBeenCalled()
})

test('uses a separate pool checkout and releases it, supporting rotating secrets', async () => {
  const { runtime, query, connect, release, transaction } = fixture()
  await linkIdentity(runtime, { headers: new Headers({ cookie: `custom_xp=${encodeUnitCookie('visitor', ['old'])}` }), userId: 'user', verified: true })
  expect(connect).toHaveBeenCalledOnce()
  expect(transaction).not.toHaveBeenCalled()
  expect(query.mock.calls[0]![0]).toMatchObject({ text: expect.stringContaining('"isolated"."xp_identities"'), values: ['visitor', 'user', true] })
  expect(query.mock.calls[0]![0].text).toContain('ON CONFLICT ("anonymous_id") DO UPDATE')
  expect(release).toHaveBeenCalledOnce()
})

test('insert failure resolves, logs and releases the checkout', async () => {
  const { runtime, query, release, error } = fixture()
  const queryError = new Error('down')
  query.mockRejectedValue(queryError)
  await expect(linkIdentity(runtime, { headers: new Headers({ cookie: `custom_xp=${encodeUnitCookie('visitor', ['new'])}` }), userId: 'user', verified: true })).resolves.toBe('failed')
  expect(error).toHaveBeenCalledOnce()
  expect(release).toHaveBeenCalledOnce()
  expect(release).toHaveBeenCalledWith(queryError)
})

test.each(['false', 'throw'])('consent %s makes linking a valid cookie to a user a no-op', async outcome => {
  const { runtime, query, connect } = fixture()
  const consent = vi.fn(() => {
    if (outcome === 'throw') throw new Error('consent unavailable')
    return false
  })
  Object.assign(runtime.proxyRuntime.cookie, { consent })
  await expect(linkIdentity(runtime, { headers: new Headers({ cookie: `custom_xp=${encodeUnitCookie('visitor', ['new'])}` }), userId: 'user', verified: true })).resolves.toBe(outcome === 'throw' ? 'failed' : 'skipped')
  expect(consent).toHaveBeenCalledOnce()
  expect(runtime.getPayload).not.toHaveBeenCalled()
  expect(connect).not.toHaveBeenCalled()
  expect(query).not.toHaveBeenCalled()
})

test('consent true receives cookies and headers on a placeholder request and allows linking', async () => {
  const { runtime, query } = fixture()
  const consent = vi.fn((request: NextRequest) => {
    expect(request).toBeInstanceOf(NextRequest)
    expect(request.url).toBe('http://consent.invalid/')
    expect(request.cookies.get('permission')?.value).toBe('yes')
    expect(request.headers.get('x-consent')).toBe('allowed')
    return true
  })
  Object.assign(runtime.proxyRuntime.cookie, { consent })
  await linkIdentity(runtime, { headers: new Headers({ cookie: `permission=yes; custom_xp=${encodeUnitCookie('visitor', ['new'])}`, 'x-consent': 'allowed' }), userId: 'user', verified: true })
  expect(consent).toHaveBeenCalledOnce()
  expect(query).toHaveBeenCalledOnce()
  expect(query.mock.calls[0]![0]).toMatchObject({ values: ['visitor', 'user', true] })
})

test.each([
  [{ rows: [{ inserted: true }], rowCount: 1 }, 'linked'],
  [{ rows: [{ inserted: false }], rowCount: 1 }, 'verified'],
  [{ rows: [], rowCount: 0 }, 'skipped'],
] as const)('returns the database outcome %s', async (result, outcome) => {
  const { runtime, query } = fixture()
  query.mockResolvedValue(result)
  await expect(linkIdentity(runtime, { headers: new Headers({ cookie: `custom_xp=${encodeUnitCookie('visitor', ['new'])}` }), userId: 'user', verified: true })).resolves.toBe(outcome)
})

test('payload failure and a throwing logger never escape sign-in', async () => {
  const { runtime, query, error } = fixture()
  query.mockRejectedValue(new Error('private'))
  error.mockImplementation(() => { throw new Error('logger') })
  await expect(linkIdentity(runtime, { headers: new Headers({ cookie: `custom_xp=${encodeUnitCookie('visitor', ['new'])}` }), userId: 'user', verified: false })).resolves.toBe('failed')
})


test('payload initialization failure returns failed without throwing', async () => {
  const { runtime } = fixture()
  vi.mocked(runtime.getPayload).mockRejectedValue(new Error('private connection details'))
  await expect(linkIdentity(runtime, { headers: new Headers({ cookie: `custom_xp=${encodeUnitCookie('visitor', ['new'])}` }), userId: 'user', verified: true })).resolves.toBe('failed')
})
