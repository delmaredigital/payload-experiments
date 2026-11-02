import { expect, test } from 'vitest'
import { decidedLine, runningLine, SURFACE_COPY } from '../../../src/admin/copy/surface.js'

test('surface copy avoids the anti-goal vocabulary', () => {
  const copy = JSON.stringify([SURFACE_COPY, runningLine('1', '28', '200'), decidedLine('today', 'Original')])
  expect(copy).not.toMatch(/\b(?:arm|phase|flag point|unit type|CUPED|exposure policy)\b/i)
})
