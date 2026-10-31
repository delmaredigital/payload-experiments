import { readFileSync, readdirSync } from 'node:fs'
import { expect, test } from 'vitest'
import { MAX_EVENTS_PER_BODY } from '../../src/constants.js'
import type { EventBody } from '../../src/types/endpoints.js'

const directory = new URL('../_fixtures/events/', import.meta.url)
const conversion = { type: 'conversion', eventName: 'registration', idempotencyKey: 'event-1' } as const
// JSON widens discriminants. Typed literals plus deep equality bind the files to EventBody.
const contracts = {
  'exposure-manual.json': { events: [{ type: 'exposure', experiment: 'example-experiment', phase: 1, arm: 'variantA', policy: 'manual' }] },
  'exposure-viewport.json': { events: [{ type: 'exposure', experiment: 'example-experiment', phase: 1, arm: 'variantA', policy: 'viewport' }] },
  'exposure-pageview.json': { events: [{ type: 'exposure', experiment: 'example-experiment', phase: 1, arm: 'variantA', policy: 'pageview' }] },
  'conversion.json': { events: [conversion] },
  'conversion-attributes.json': { events: [{ ...conversion, attributes: { campaign: 'autumn', amount: 2, member: true } }] },
  'batch-20.json': { events: Array.from({ length: 20 }, (_, index) => ({ ...conversion, idempotencyKey: `event-${index + 1}` })) },
} satisfies Record<string, EventBody>

test('fixture inventory is the shared contract; oversize bodies belong in tests', () => {
  expect(readdirSync(directory).sort()).toEqual(Object.keys(contracts).sort())
})

for (const [filename, contract] of Object.entries(contracts)) {
  test(`${filename} parses, matches EventBody and uses the exact wire keys`, () => {
    const body = JSON.parse(readFileSync(new URL(filename, directory), 'utf8'))
    expect(body).toEqual(contract)
    expect(Object.keys(body)).toEqual(['events'])
    for (const event of body.events) {
      if (event.type === 'exposure') {
        expect(Object.keys(event).sort()).toEqual(['type', 'experiment', 'phase', 'arm', 'policy'].sort())
        expect(typeof event.experiment).toBe('string')
        expect(typeof event.arm).toBe('string')
        expect(Number.isInteger(event.phase)).toBe(true)
        expect(['manual', 'viewport', 'pageview']).toContain(event.policy)
      } else {
        expect(event.type).toBe('conversion')
        expect(Object.keys(event).sort()).toEqual(['type', 'eventName', 'idempotencyKey', ...(event.attributes ? ['attributes'] : [])].sort())
        expect(typeof event.eventName).toBe('string')
        expect(typeof event.idempotencyKey).toBe('string')
        for (const value of Object.values(event.attributes ?? {})) expect(['string', 'number', 'boolean']).toContain(typeof value)
      }
    }
    expect(body.events).toHaveLength(filename === 'batch-20.json' ? MAX_EVENTS_PER_BODY : 1)
  })
}
