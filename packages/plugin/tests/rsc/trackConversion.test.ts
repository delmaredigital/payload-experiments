import { safeError } from '../../src/log.js'
import type { Payload } from 'payload'
import { NextRequest } from 'next/server'
import { PgDialect } from 'drizzle-orm/pg-core'
import { afterEach, expect, test, vi } from 'vitest'
import { headers as requestHeaders } from 'next/headers.js'
import { trackConversion } from '../../src/server/trackConversion.js'
import { encodeUnitCookie } from '../../src/runtime/cookie.js'
import type { ExperimentsServerRuntime } from '../../src/types/runtime.js'

vi.mock('next/headers.js', () => ({ headers: vi.fn(async () => new Headers()) }))
afterEach(() => vi.mocked(requestHeaders).mockReset().mockResolvedValue(new Headers() as Awaited<ReturnType<typeof requestHeaders>>))
function fixture() {
  const execute = vi.fn().mockResolvedValue({ rows: [{ id: 1 }] })
  const error = vi.fn()
  const warn = vi.fn()
  const runtime = { proxyRuntime: { secrets: ['secret'], cookie: { name: 'xp_id' } },
    getPayload: vi.fn().mockResolvedValue({ db: { drizzle: { execute } }, logger: { error, warn } } as unknown as Payload),
    getUser: vi.fn().mockResolvedValue(null), userIdOf: (user: { id: string | number }) => String(user.id),
  } as unknown as ExperimentsServerRuntime
  return { runtime, execute, error, warn }
}

test('duplicate signed cookies attribute conversions to the last visitor', async () => {
  const { runtime, execute } = fixture()
  const cookie = `xp_id=${encodeUnitCookie('first', ['secret'])}; xp_id=${encodeUnitCookie('last', ['secret'])}`
  await trackConversion(runtime, { eventName: 'event', idempotencyKey: 'key', headers: new Headers({ cookie }) })
  const params = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]).params
  expect(params[4]).toBe('last')
  expect(params[5]).toBe('visitor')
})

test('signed cookie writes visitor conversion with server namespace and user attribution', async () => {
  const { runtime, execute } = fixture()
  await trackConversion(runtime, { eventName: 'donation', idempotencyKey: 'receipt', value: 10, userId: 'user', headers: new Headers({ cookie: `other=x; xp_id=${encodeUnitCookie('visitor', ['secret'])}` }) })
  const query = JSON.stringify(execute.mock.calls)
  for (const value of ['visitor', 'user', 'donation', 'conversion:s:receipt']) expect(query).toContain(value)
})

test.each(['visitor', encodeUnitCookie('visitor', ['wrong'])])('unsigned or tampered cookie is ignored (%s)', async cookie => {
  const { runtime, execute } = fixture()
  await trackConversion(runtime, { eventName: 'event', idempotencyKey: 'key', headers: new Headers({ cookie: `xp_id=${cookie}` }) })
  expect(execute).not.toHaveBeenCalled()
})

test('explicit user-only conversions default to value 1', async () => {
  const { runtime, execute } = fixture()
  await trackConversion(runtime, { eventName: 'event', idempotencyKey: 'key', userId: 'user' })
  const query = JSON.stringify(execute.mock.calls)
  expect(query).toContain('conversion:s:key')
  expect(query).toContain('user')
  expect(query).not.toContain('visitor')
})

test('resolves user through the host adapter', async () => {
  const { runtime, execute } = fixture()
  vi.mocked(runtime.getUser!).mockResolvedValue({ id: 42 })
  await trackConversion(runtime, { eventName: 'event', idempotencyKey: 'key', headers: new Headers() })
  expect(JSON.stringify(execute.mock.calls)).toContain('42')
})

test('database and logger errors resolve', async () => {
  const { runtime, execute, error } = fixture()
  execute.mockRejectedValue(new Error('down'))
  error.mockImplementation(() => { throw new Error('down') })
  await expect(trackConversion(runtime, { eventName: 'event', idempotencyKey: 'key', userId: 'user', headers: new Headers() })).resolves.toBeUndefined()
  expect(error).toHaveBeenCalledOnce()
})

test('a user-only conversion survives unavailable request headers', async () => {
  const { runtime, execute } = fixture()
  vi.mocked(requestHeaders).mockRejectedValue(new Error('Outside request scope'))
  await expect(trackConversion(runtime, { eventName: 'event', idempotencyKey: 'background', userId: 'user' })).resolves.toBeUndefined()
  expect(execute).toHaveBeenCalledOnce()
  expect(JSON.stringify(execute.mock.calls)).toContain('conversion:s:background')
})

test.each([
  ['false', undefined], ['false', 'user'], ['throw', undefined], ['throw', 'user'],
] as const)('consent %s blocks a valid visitor cookie and explicit user %s', async (outcome, userId) => {
  const { runtime, execute } = fixture()
  const consent = vi.fn(() => {
    if (outcome === 'throw') throw new Error('consent unavailable')
    return false
  })
  Object.assign(runtime.proxyRuntime.cookie, { consent })
  await expect(trackConversion(runtime, { eventName: 'event', idempotencyKey: 'key', userId, headers: new Headers({ cookie: `xp_id=${encodeUnitCookie('visitor', ['secret'])}` }) })).resolves.toBeUndefined()
  expect(consent).toHaveBeenCalledOnce()
  expect(runtime.getPayload).not.toHaveBeenCalled()
  expect(runtime.getUser).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
})

test('consent false blocks a user-only conversion without request headers', async () => {
  const { runtime, execute } = fixture()
  vi.mocked(requestHeaders).mockRejectedValue(new Error('Outside request scope'))
  const consent = vi.fn(() => false)
  Object.assign(runtime.proxyRuntime.cookie, { consent })
  await trackConversion(runtime, { eventName: 'event', idempotencyKey: 'key', userId: 'user' })
  expect(consent).toHaveBeenCalledOnce()
  expect(runtime.getPayload).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
})

test('consent true receives request cookies and headers and allows a conversion', async () => {
  const { runtime, execute } = fixture()
  const consent = vi.fn((request: NextRequest) => {
    expect(request).toBeInstanceOf(NextRequest)
    expect(request.url).toBe('http://consent.invalid/')
    expect(request.cookies.get('permission')?.value).toBe('yes')
    expect(request.headers.get('x-consent')).toBe('allowed')
    return true
  })
  Object.assign(runtime.proxyRuntime.cookie, { consent })
  vi.mocked(requestHeaders).mockResolvedValue(new Headers({ cookie: `permission=yes; xp_id=${encodeUnitCookie('visitor', ['secret'])}`, 'x-consent': 'allowed' }) as Awaited<ReturnType<typeof requestHeaders>>)
  await trackConversion(runtime, { eventName: 'event', idempotencyKey: 'key' })
  expect(consent).toHaveBeenCalledOnce()
  expect(execute).toHaveBeenCalledOnce()
})

test.each([false, true])('getUser failure logs and preserves visitor attribution even if logging throws (%s)', async loggerThrows => {
  const { runtime, execute, error } = fixture()
  const userError = new Error('auth unavailable')
  vi.mocked(runtime.getUser!).mockRejectedValue(userError)
  if (loggerThrows) error.mockImplementation(() => { throw new Error('logger unavailable') })
  await expect(trackConversion(runtime, { eventName: 'event', idempotencyKey: 'key', headers: new Headers({ cookie: `xp_id=${encodeUnitCookie('visitor', ['secret'])}` }) })).resolves.toBeUndefined()
  expect(error).toHaveBeenCalledExactlyOnceWith({ err: safeError(userError) }, 'Experiments: trackConversion getUser failed')
  expect(execute).toHaveBeenCalledOnce()
  expect(new PgDialect().sqlToQuery(execute.mock.calls[0]![0]).params).toEqual([
    'conversion', null, null, null, 'visitor', 'visitor', null, 'event', 1, expect.any(String), null, null, 'conversion:s:key',
  ])
})

test.each(['', ' ', '\t\n'])('empty idempotencyKey %j logs one warning and writes nothing', async idempotencyKey => {
  const { runtime, execute, error, warn } = fixture()
  await expect(trackConversion(runtime, { eventName: 'event', idempotencyKey, userId: 'user', headers: new Headers({ cookie: `xp_id=${encodeUnitCookie('visitor', ['secret'])}` }) })).resolves.toBeUndefined()
  expect(warn).toHaveBeenCalledExactlyOnceWith('Experiments: trackConversion requires a non-empty idempotencyKey')
  expect(error).not.toHaveBeenCalled()
  expect(runtime.getUser).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
})
