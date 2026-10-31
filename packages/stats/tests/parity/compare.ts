import { expect } from 'vitest'

/** Compare the entire fixture shape, with the frozen numeric tolerance. */
export function expectParity(actual: unknown, expected: unknown, path = '$'): void {
  if (typeof expected === 'number') {
    expect(typeof actual, path).toBe('number')
    const value = actual as number
    if (!Number.isFinite(expected) || !Number.isFinite(value)) {
      expect(value, path).toBe(expected)
    } else {
      expect(Math.abs(value - expected), path).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(expected)))
    }
    return
  }

  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true)
    const values = actual as unknown[]
    expect(values.length, `${path}.length`).toBe(expected.length)
    expected.forEach((value, i) => expectParity(values[i], value, `${path}[${i}]`))
    return
  }

  if (expected !== null && typeof expected === 'object') {
    expect(actual !== null && typeof actual === 'object' && !Array.isArray(actual), path).toBe(true)
    const values = actual as Record<string, unknown>
    expect(Object.keys(values).sort(), `${path} keys`).toEqual(Object.keys(expected).sort())
    for (const [key, value] of Object.entries(expected)) {
      expectParity(values[key], value, `${path}.${key}`)
    }
    return
  }

  expect(actual, path).toBe(expected)
}
