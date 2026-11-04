import { expect, test, vi } from 'vitest'
import { pageGuardCopy, versionPageUnavailableCopy, versionPageUncheckedCopy } from '../../../src/admin/copy/readiness.js'
import { ROUTES } from '../../../src/endpoints/index.js'
import type { Status } from '../../../src/types/contracts.js'
import { createFakeExecutor } from '../../_fakes/executor.js'
import { fakePayload } from '../../_fakes/payload.js'
import { sampleOptions } from '../../collections/fixtures.js'

const statuses: Status[] = ['draft', 'running', 'stopped', 'decided', 'archived']
// Copy-to-route contract only. The route table supplies the actual handler,
// and the tests below exercise its real status refusals (no transition mocks).
const actions: Array<{ labels: string[]; endpointPath?: string; host?: true; statuses: string[]; body?: Record<string, unknown> }> = [
  { labels: ['stop the test'], endpointPath: '/xp/experiments/:id/stop', statuses: ['running'], body: {} },
  { labels: ['Make it the content'], endpointPath: '/xp/experiments/:id/make-content', statuses: ['decided'], body: {} },
  { labels: ['Discard winner', 'discard the winner'], endpointPath: '/xp/experiments/:id/archive', statuses: ['decided'], body: { mode: 'discard', confirmation: 'discard winner' } },
  { labels: ['Release pages'], endpointPath: '/xp/experiments/:id/release-pages', statuses: ['archived'], body: {} },
  // Republishing is the editor's own publish of the host page, not an experiment transition.
  { labels: ['Republish'], host: true, statuses: ['running', 'decided'] },
]
const actionFor = (label: string) => actions.find(action => action.labels.some(value => value.toLowerCase() === label.toLowerCase()))

test.each(['running', 'decided', 'archived'] as const)('every quoted guard action exists and allows %s', status => {
  const name = '__test_name__'
  const copy = pageGuardCopy(name, status)
  const labels = [...copy.matchAll(/"([^"]+)"/g)].map(match => match[1]!).filter(label => label !== name)
  if (/Stop the test/.test(copy)) labels.push('stop the test')
  expect(labels.length).toBeGreaterThan(0)
  for (const label of labels) {
    const action = actionFor(label)
    expect(action, `No route mapping for guard action "${label}"`).toBeDefined()
    expect(action!.statuses).toContain(status)
    if (!action!.host) expect(ROUTES.find(route => route.path === action!.endpointPath && route.method === 'post'), label).toMatchObject({ access: 'manage' })
  }
})

test.each(['running', 'decided'])('every version-page health action has a transition in %s', status => {
  const unavailable = versionPageUnavailableCopy('/page', status)
  const unchecked = versionPageUncheckedCopy('/page', status)
  const labels = [
    ...unavailable.slice(unavailable.lastIndexOf('. ') + 2).replace(/\.$/, '').split(', or ').map(label => label === 'Republish it' ? 'Republish' : label),
    unchecked.split(', or ')[1]!.replace(/\.$/, ''),
  ]
  for (const label of labels) {
    const action = actionFor(label)
    expect(action, `No route mapping for health action "${label}"`).toBeDefined()
    expect(action!.statuses).toContain(status)
    if (!action!.host) expect(ROUTES.find(route => route.path === action!.endpointPath && route.method === 'post'),
      `Health copy action "${label}" has no experiment transition (${action!.endpointPath})`).toBeDefined()
  }
})

for (const action of actions.filter(action => !action.host)) {
  const route = ROUTES.find(route => route.path === action.endpointPath && route.method === 'post')
  // Missing routes fail the copy checks above; there is no handler to probe.
  if (!route) continue
  test.each(statuses)(`${action.labels[0]}: real endpoint status check in %s`, async status => {
    const options = sampleOptions()
    const executor = createFakeExecutor()
    executor.query = async <R>(text: string) => ({ rows: (text.includes('RETURNING "revision"') ? [{ revision: 1 }] : []) as R[], rowCount: 1 })
    const arms = [{ key: 'control', kind: 'control', pageTarget: '/original' }, { key: 'variantA', kind: 'variant', pageTarget: '/winner' }]
    const payload = fakePayload({ executor, config: { custom: { xp: options } },
      overrides: { findGlobal: vi.fn(async () => ({ flagDefaults: {} })) }, collections: {
        'xp-experiments': [{ id: 1, slug: 'page', kind: 'page', status, phase: 1, arms, decision: { winnerArm: 'variantA' } }],
        'xp-phases': [{ id: 2, experiment: 1, phase: 1, phaseKind: 'test', arms }],
      } })
    Object.assign(payload.db, { defaultIDType: 'number' })
    const req = executor.withSession({ payload })
    req.routeParams = { id: 1 }
    req.data = action.body
    const response = await route.handler(req, { options })
    if (action.statuses.includes(status)) expect(response.status).toBe(200)
    else {
      expect(response.status).toBe(422)
      expect(await response.json()).toMatchObject({ errors: [{ code: 'invalid-status' }] })
    }
  })
}
