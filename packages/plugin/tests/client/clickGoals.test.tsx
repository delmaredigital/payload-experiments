// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { ExperimentsProvider } from '../../src/client/ExperimentsProvider.js'
import { assignments, bodyOf, transport } from './helpers.js'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

test('nested providers send one beacon per click from the deepest armed provider, StrictMode safe', async () => {
  const { sendBeacon } = transport()
  const add = vi.spyOn(document, 'addEventListener'), remove = vi.spyOn(document, 'removeEventListener')
  const outer = assignments({ apiRoute: '/layout', clickGoalsArmed: true })
  const inner = assignments({ apiRoute: '/page', clickGoalsArmed: true })
  const view = render(<StrictMode><ExperimentsProvider value={outer}><ExperimentsProvider value={inner}>
    <div data-xp-goal="outer"><button data-xp-goal="join"><span>Join</span></button></div>
  </ExperimentsProvider></ExperimentsProvider></StrictMode>)
  fireEvent.click(view.getByText('Join'))
  expect(sendBeacon).toHaveBeenCalledTimes(1)
  expect(sendBeacon.mock.calls[0]![0]).toBe('/page/xp/events')
  const event = (await bodyOf(sendBeacon.mock.calls[0]![1])).events[0]!
  expect(event).toMatchObject({ type: 'conversion', eventName: 'click:join', idempotencyKey: expect.stringMatching(/:join$/) })
  expect(add.mock.calls.filter(([name]) => name === 'click').length - remove.mock.calls.filter(([name]) => name === 'click').length).toBe(1)
  view.unmount()
  expect(add.mock.calls.filter(([name]) => name === 'click')).toHaveLength(remove.mock.calls.filter(([name]) => name === 'click').length)
})
test('soft navigation re-mints pageviewId on value identity change, stable renders preserve it', async () => {
  const { sendBeacon } = transport()
  const value = assignments({ clickGoalsArmed: true })
  const tree = (v = value) => <ExperimentsProvider value={v}><button data-xp-goal="join">Join</button></ExperimentsProvider>
  const view = render(tree())
  fireEvent.click(view.getByText('Join'))
  view.rerender(tree())
  fireEvent.click(view.getByText('Join'))
  view.rerender(tree({ ...value }))
  fireEvent.click(view.getByText('Join'))
  const events = await Promise.all(sendBeacon.mock.calls.map(async ([, body]) => (await bodyOf(body)).events[0]!))
  const keys = events.map(e => e.type === 'conversion' ? e.idempotencyKey : '')
  expect(keys[0]).toBe(keys[1]); expect(keys[2]).not.toBe(keys[1])
})
test('unarmed nested provider falls back to armed parent; equal depth uses latest registration', () => {
  const { sendBeacon } = transport()
  const a = render(<ExperimentsProvider value={assignments({ apiRoute: '/parent', clickGoalsArmed: true })}>
    <ExperimentsProvider value={assignments()}><button data-xp-goal="join">Join</button></ExperimentsProvider>
  </ExperimentsProvider>)
  fireEvent.click(a.getByText('Join'))
  const b = render(<ExperimentsProvider value={assignments({ apiRoute: '/latest', clickGoalsArmed: true })}>Latest</ExperimentsProvider>)
  fireEvent.click(a.getByText('Join')); b.unmount(); fireEvent.click(a.getByText('Join'))
  expect(sendBeacon.mock.calls.map(([url]) => url)).toEqual(['/parent/xp/events', '/latest/xp/events', '/parent/xp/events'])
})
test('unarmed providers and invalid closest keys send nothing', () => {
  const { sendBeacon } = transport()
  const view = render(<ExperimentsProvider value={assignments()}><button data-xp-goal="join">Join</button></ExperimentsProvider>)
  fireEvent.click(view.getByText('Join'))
  view.rerender(<ExperimentsProvider value={assignments({ clickGoalsArmed: true })}><div data-xp-goal="join"><button data-xp-goal="BAD">Join</button></div></ExperimentsProvider>)
  fireEvent.click(view.getByText('Join'))
  expect(sendBeacon).not.toHaveBeenCalled()
})

test("a decided rollout's holdout clicks are recorded", async () => {
  const { toClientAssignments } = await import('../../src/server/toClientAssignments.js')
  const { assignments: serverAssignments, experiment, manifest } = await import('../rsc/helpers.js')
  const a = serverAssignments(manifest([experiment({ status: 'decided', phaseKind: 'rollout', winnerArm: 'variantA', holdoutKey: 'holdout', arms: [
    { key: 'control', kind: 'control', weight: 0 }, { key: 'variantA', kind: 'variant', weight: 0 }, { key: 'holdout', kind: 'holdout', weight: 100 },
  ] })]))
  expect(a.bySlug.hero).toMatchObject({ arm: 'holdout', exposable: true })
  const value = toClientAssignments(a, { pathname: '/' })
  const { sendBeacon } = transport()
  const view = render(<ExperimentsProvider value={value}><button data-xp-goal="join">Join</button></ExperimentsProvider>)
  fireEvent.click(view.getByText('Join'))
  expect(sendBeacon).toHaveBeenCalledTimes(1)
  expect((await bodyOf(sendBeacon.mock.calls[0]![1])).events[0]).toMatchObject({ type: 'conversion', eventName: 'click:join' })
})

test('provider mounts without randomUUID and a click still sends one beacon', async () => {
  vi.stubGlobal('crypto', { randomUUID: undefined, getRandomValues: (bytes: Uint8Array) => bytes.fill(7) })
  const { sendBeacon } = transport()
  const view = render(<ExperimentsProvider value={assignments({ clickGoalsArmed: true })}><button data-xp-goal="join">Join</button></ExperimentsProvider>)
  fireEvent.click(view.getByText('Join'))
  expect(sendBeacon).toHaveBeenCalledTimes(1)
  expect((await bodyOf(sendBeacon.mock.calls[0]![1])).events[0]).toMatchObject({ eventName: 'click:join', idempotencyKey: expect.stringMatching(/:join$/) })
}, 5_000) // Measured 2 ms locally; cap exceeds 3×.
