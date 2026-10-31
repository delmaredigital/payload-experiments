import { describe, expect, it } from 'vitest'
import { expectParity } from './compare.js'
import { decode, loadFixture } from './fixtures.js'
import { manifest } from './manifest.js'
import { pending } from './pending.js'
import { runners } from './runners.js'

// GrowthBook packages/sdk-js/test/json.test.ts:107-109, 258-262, 292
// floors both sides for getBucketRanges and getEqualWeights only.
function upstreamFloor(value: unknown): unknown {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value * 1e8) / 1e8
  if (Array.isArray(value)) return value.map(upstreamFloor)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, upstreamFloor(child)]))
  }
  return value
}

for (const { key, fixture } of manifest) {
  if (pending.has(fixture)) {
    describe.skip(`${fixture} (fixture pending: generated on the lane's train)`, () => {
      it('awaits generated cases', () => {})
    })
    continue
  }

  describe(fixture, () => {
    const data = loadFixture(fixture)
    if (!data) throw new Error(`Missing active fixture: ${fixture}`)
    it('has generated cases', () => {
      expect(data.cases.length, fixture).toBeGreaterThan(0)
    })
    for (const { name, input, expected } of data.cases) {
      it(name, () => {
        const runner = runners[key]
        if (!runner) throw new Error(`Missing runner: ${key}`)
        expect(Array.isArray(input?.args), `${fixture}/${name}: input.args`).toBe(true)
        const args = decode(input.args) as unknown[]
        const raises = expected !== null && typeof expected === 'object' && '$raises' in expected
        let actual: unknown
        let threw = false
        try {
          actual = runner(...args)
        } catch (error) {
          expect(error instanceof Error && error.message.startsWith('not implemented: '), 'stub reached').toBe(false)
          if (!raises) throw error
          threw = true
        }
        if (raises) {
          expect(threw).toBe(true)
        } else {
          const decodedExpected = decode(expected)
          if (data.compare === 'upstream-floor-1e8') {
            expectParity(upstreamFloor(actual), upstreamFloor(decodedExpected))
          } else {
            expectParity(actual, decodedExpected)
          }
        }
      })
    }
  })
}
