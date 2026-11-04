import { NEW_TEST_COPY } from '../../../src/admin/copy/newTest.js'
import { expect, test } from 'vitest'
import { decidedLine, runningLine, SURFACE_COPY } from '../../../src/admin/copy/surface.js'

test('surface copy avoids the anti-goal vocabulary', () => {
  const copy = JSON.stringify([SURFACE_COPY, NEW_TEST_COPY, runningLine('1', '28', '200'), decidedLine('today', 'Original')])
  expect(copy).not.toMatch(/\b(?:arm|phase|flag point|unit type|CUPED|exposure policy)\b/i)
})

test('the routed surface no longer advertises placeholder screens', () => {
  expect(Object.keys(SURFACE_COPY).filter(key => key.endsWith('Placeholder'))).toEqual([])
})

test('surface copy names the test and results routes', () => {
  expect(SURFACE_COPY.test).toBe('Test')
  expect(SURFACE_COPY.resultsTitle).toBe('Results')
})
