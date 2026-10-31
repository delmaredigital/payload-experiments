import { describe, expect, it } from 'vitest'
import { expectParity } from './compare.js'
import { decode, loadFixture } from './fixtures.js'
import { manifest } from './manifest.js'
import { pending } from './pending.js'
import { runners } from './runners.js'

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
          expectParity(actual, decode(expected))
        }
      })
    }
  })
}
