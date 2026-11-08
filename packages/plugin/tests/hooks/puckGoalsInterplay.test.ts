import { createPuckPlugin } from '@delmaredigital/payload-puck/plugin'
import { APIError, ValidationError, type CollectionBeforeChangeHook, type Config } from 'payload'
import { afterEach, expect, test, vi } from 'vitest'
import { CLICK_GOAL_COPY, puckGoalRefusal } from '../../src/goals/picker/copy.js'
import { puckGoalsBeforeChange } from '../../src/hooks/puckGoals.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { sampleOptions } from '../collections/fixtures.js'

vi.mock('../../src/goals/cache.js', () => ({ clickKeys: vi.fn(async () => new Set()) }))
vi.mock('../../src/db/clickGoals.js', () => ({ definedClickKeys: vi.fn(async () => new Set()) }))
afterEach(() => { vi.restoreAllMocks() })

// Measured CORE-L5d related run: all four cases together <30 ms; each 3,000 ms cap exceeds 3×.
const data = { _status: 'published', puckData: { content: [{ type: 'CourseCTA', props: { xpGoal: 'missing' } }] } }
async function refusal() {
  const payload = fakePayload({ config: { custom: { xp: sampleOptions() } } })
  try {
    await puckGoalsBeforeChange('puckData')({ collection: { slug: 'pages' }, context: {}, data, req: fakeReq({ payload }), operation: 'update' } as unknown as Parameters<CollectionBeforeChangeHook>[0])
  } catch (error) {
    if (error instanceof ValidationError) return error
    throw error
  }
  throw new Error('Expected publish refusal')
}

test('installed Payload preserves ValidationError name, status and field errors', async () => {
  const error = await refusal()
  expect(error).toBeInstanceOf(Error)
  expect(error).toBeInstanceOf(ValidationError)
  expect(error.name).toBe('ValidationError')
  expect(error.status).toBe(400)
  expect(error.data).toEqual({ collection: 'pages', errors: [{ path: 'puckData.content.0.props.xpGoal', message: CLICK_GOAL_COPY.undefinedKey }] })
}, 3_000)

test('cc-lms registered endpoint returns our sentence from the actual installed handler', async () => {
  const error = await refusal()
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  const config = await createPuckPlugin({ pagesCollection: 'pages', autoGenerateCollection: false, enableAdminView: false })({ collections: [] } as unknown as Config)
  const endpoint = config.endpoints!.find(endpoint => endpoint.path === '/puck/:collection/:id' && endpoint.method === 'patch')!
  const update = vi.fn().mockRejectedValue(error)
  const payload = fakePayload({ overrides: { update } })
  const response = await endpoint.handler(fakeReq({ payload, body: JSON.stringify(data), routeParams: { collection: 'pages', id: '1' } }))
  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({ error: puckGoalRefusal('missing', 'Course CTA', false), data: error.data })
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ overrideAccess: false, draft: false }))
  expect(consoleError).toHaveBeenCalledWith('[payload-puck] Update error:', error)
}, 3_000)

// The installed standalone API barrel cannot load in Node: its extensionless next/server
// import fails. Mirror both exact branches from payload-puck/src/api/createPuckApiRoutesWithId.ts:339–371
// and src/api/createPuckApiRoutes.ts:283–306, plus src/utils/payloadErrors.ts:25–42,75–88.
// The actual registered handler used by cc-lms is exercised above without that barrel.
test.each(['named', 'fallback'] as const)('standalone branch logic preserves our copy in the %s branch', async branch => {
  const error = await refusal()
  // Emulate a renamed class name for the fallback; installed Payload itself sets ValidationError.
  if (branch === 'fallback') error.name = 'BundledValidationError'
  const respond = (incoming: unknown) => {
    if (incoming instanceof Error && incoming.name === 'ValidationError') {
      const validationError = incoming as Error & { data?: { errors?: Array<{ field: string; message: string }> } }
      const fieldErrors = validationError.data?.errors || []
      return Response.json({ error: `Validation failed: ${fieldErrors.map(e => e.message || e.field).join(', ')}`, details: fieldErrors }, { status: 400 })
    }
    const status = incoming instanceof APIError && typeof incoming.status === 'number' ? incoming.status
      : incoming instanceof Error && typeof (incoming as APIError).status === 'number'
        && (incoming as APIError).status >= 400 && (incoming as APIError).status <= 599
        && typeof (incoming as APIError).isOperational === 'boolean' ? (incoming as APIError).status : null
    if (status === null || status < 400 || status >= 500) return null
    const isPublic = incoming instanceof Error && (incoming as APIError).isPublic === true
    const clientMessages: Record<number, string> = { 400: 'Bad request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not found', 409: 'Conflict' }
    const message = isPublic && incoming.message ? incoming.message : (clientMessages[status] ?? 'Request failed')
    return Response.json({ error: message }, { status })
  }
  const response = respond(error)!
  expect(response.status).toBe(400)
  const body = await response.json()
  expect(body.error).toBe(branch === 'named' ? `Validation failed: ${CLICK_GOAL_COPY.undefinedKey}` : puckGoalRefusal('missing', 'Course CTA', false))
  if (branch === 'named') expect(body.details).toEqual(error.data.errors)
}, 3_000)
