import type { Payload } from 'payload'
import { afterEach, expect, test, vi } from 'vitest'
import { recordExposures } from '../../src/server/recordExposures.js'
import type { Assignments } from '../../src/types/assignments.js'
import type { ExperimentsServerRuntime } from '../../src/types/runtime.js'

const assignment = { slug: 'hero', experimentId: 1, arm: 'control', phase: 2, exposable: true, policy: 'render', source: 'header' } as const
const rendered = [{ slug: 'hero', arm: 'control', phase: 2 }]
function fixture(unitType = 'visitor') {
  const execute = vi.fn().mockResolvedValue({ rows: [{ revision: 1, manifest: { experiments: [{ id: 1, slug: 'hero', unitType }] } }] })
  const error = vi.fn()
  const runtime = { getPayload: async () => ({ db: { drizzle: { execute } }, logger: { error } } as unknown as Payload) } as ExperimentsServerRuntime
  const ctx: Assignments = { archivedWinners: {}, revision: 1, visitorId: 'visitor', userId: 'user', bySlug: { hero: assignment }, flagPoints: {}, staff: false, bot: false, preview: false, sessionUnknown: false, method: 'GET' }
  return { runtime, ctx, execute, error }
}
afterEach(() => vi.useRealTimers())

test.each(['bot', 'staff', 'preview', 'HEAD', 'consent', 'non-exposable', 'viewport', 'pageview', 'arm', 'phase', 'missing-unit'])('skips %s', async mode => {
  const { runtime, ctx, execute } = fixture()
  if (mode === 'bot' || mode === 'staff' || mode === 'preview') ctx[mode] = true
  if (mode === 'HEAD') ctx.method = 'HEAD'
  if (mode === 'consent') { ctx.bySlug = {}; delete ctx.visitorId }
  if (mode === 'non-exposable') ctx.bySlug.hero = { ...assignment, exposable: false }
  if (mode === 'viewport' || mode === 'pageview') ctx.bySlug.hero = { ...assignment, policy: mode }
  if (mode === 'arm') ctx.bySlug.hero = { ...assignment, arm: 'variantA' }
  if (mode === 'phase') ctx.bySlug.hero = { ...assignment, phase: 3 }
  if (mode === 'missing-unit') delete ctx.visitorId
  await recordExposures(runtime, rendered, ctx)
  expect(execute).toHaveBeenCalledTimes(mode === 'missing-unit' ? 1 : 0)
})

test.each([['visitor', 'render'], ['user', 'render'], ['visitor', 'manual'], ['user', 'manual']] as const)('writes a %s %s exposure using a UTC day and known user', async (unitType, policy) => {
  vi.useFakeTimers().setSystemTime(new Date('2026-10-30T23:30:00-04:00'))
  const { runtime, ctx, execute } = fixture(unitType)
  ctx.bySlug.hero = { ...assignment, policy }
  await recordExposures(runtime, rendered, ctx)
  const query = JSON.stringify(execute.mock.calls[1])
  const unitId = unitType === 'user' ? 'user' : 'visitor'
  expect(query).toContain(`exposure:1:2:control:${unitId}:2026-10-31`)
  expect(query).toContain('2026-10-31T03:30:00.000Z')
  expect(query).toContain('user')
  expect(execute).toHaveBeenCalledTimes(2)
})

test('executor and logger failures never reach the page', async () => {
  const { runtime, ctx, execute, error } = fixture()
  execute.mockRejectedValue(new Error('database down'))
  error.mockImplementation(() => { throw new Error('logger down') })
  await expect(recordExposures(runtime, rendered, ctx)).resolves.toBeUndefined()
  expect(error).toHaveBeenCalledOnce()
})
