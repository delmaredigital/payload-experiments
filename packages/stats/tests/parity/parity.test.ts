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
    for (const { name, input, expected } of data.cases) {
      it(name, () => {
        const runner = runners[key]
        if (!runner) throw new Error(`Missing runner: ${key}`)
        const args = decode(input.args) as unknown[]
        if (expected !== null && typeof expected === 'object' && '$raises' in expected) {
          expect(() => runner(...args)).toThrow()
        } else {
          expectParity(runner(...args), decode(expected))
        }
      })
    }
  })
}
