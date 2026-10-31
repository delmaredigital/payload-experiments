import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pending } from './pending.js'

export const FIXTURE_DIR = process.env.XP_FIXTURE_DIR ?? fileURLToPath(new URL('../../fixtures/', import.meta.url))

export interface Fixture {
  source: { repo: string; sha: string; module: string; symbol: string; pins: Record<string, unknown>; compareRef?: string }
  compare?: 'upstream-floor-1e8'
  cases: Array<{ name: string; input: { args: unknown[] }; expected: unknown }>
}

/** Decode only the exact non-finite number sentinel, recursively. */
export function decode(value: unknown): any {
  if (Array.isArray(value)) return value.map(decode)
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>
    if (Object.keys(object).length === 1 && '$num' in object) {
      if (object.$num === 'inf') return Infinity
      if (object.$num === '-inf') return -Infinity
      if (object.$num === 'nan') return NaN
    }
    return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, decode(child)]))
  }
  return value
}

/** A missing pending fixture has no cases yet; any other missing file is an error. */
export function loadFixture(name: string): Fixture | undefined {
  const path = join(FIXTURE_DIR, `${name}.json`)
  if (!existsSync(path) && pending.has(name)) return undefined
  return JSON.parse(readFileSync(path, 'utf8')) as Fixture
}
