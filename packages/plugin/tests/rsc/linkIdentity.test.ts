import type { Payload } from 'payload'
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

test.each([undefined, 'visitor', encodeUnitCookie('visitor', ['wrong']), `visitor.${sign('visitor', ['new'])}`])('rejects absent/unsigned/tampered/old-format cookies (%s)', async cookie => {
  const { runtime, connect } = fixture()
  await linkIdentity(runtime, { headers: new Headers(cookie ? { cookie: `custom_xp=${cookie}` } : {}), userId: 'user' })
  expect(connect).not.toHaveBeenCalled()
})

test('uses a separate pool checkout and releases it, supporting rotating secrets', async () => {
  const { runtime, query, connect, release, transaction } = fixture()
  await linkIdentity(runtime, { headers: new Headers({ cookie: `custom_xp=${encodeUnitCookie('visitor', ['old'])}` }), userId: 'user' })
  expect(connect).toHaveBeenCalledOnce()
  expect(transaction).not.toHaveBeenCalled()
  expect(query.mock.calls[0]![0]).toMatchObject({ text: expect.stringContaining('"isolated"."xp_identities"'), values: ['visitor', 'user'] })
  expect(query.mock.calls[0]![0].text).toContain('ON CONFLICT ("anonymous_id") DO NOTHING')
  expect(release).toHaveBeenCalledOnce()
})

test('insert failure resolves, logs and releases the checkout', async () => {
  const { runtime, query, release, error } = fixture()
  query.mockRejectedValue(new Error('down'))
  await expect(linkIdentity(runtime, { headers: new Headers({ cookie: `custom_xp=${encodeUnitCookie('visitor', ['new'])}` }), userId: 'user' })).resolves.toBeUndefined()
  expect(error).toHaveBeenCalledOnce()
  expect(release).toHaveBeenCalledOnce()
})
