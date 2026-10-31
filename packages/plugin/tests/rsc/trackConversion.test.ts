import type { Payload } from 'payload'
import { afterEach, expect, test, vi } from 'vitest'
import { headers as requestHeaders } from 'next/headers'
import { trackConversion } from '../../src/server/trackConversion.js'
import { encodeUnitCookie } from '../../src/runtime/cookie.js'
import type { ExperimentsServerRuntime } from '../../src/types/runtime.js'

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }))
afterEach(() => vi.mocked(requestHeaders).mockReset().mockResolvedValue(new Headers() as Awaited<ReturnType<typeof requestHeaders>>))
function fixture() {
  const execute = vi.fn().mockResolvedValue({ rows: [{ id: 1 }] })
  const error = vi.fn()
  const runtime = { proxyRuntime: { secrets: ['secret'], cookie: { name: 'xp_id' } },
    getPayload: async () => ({ db: { drizzle: { execute } }, logger: { error } } as unknown as Payload),
    getUser: vi.fn().mockResolvedValue(null), userIdOf: (user: { id: string | number }) => String(user.id),
  } as unknown as ExperimentsServerRuntime
  return { runtime, execute, error }
}

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
