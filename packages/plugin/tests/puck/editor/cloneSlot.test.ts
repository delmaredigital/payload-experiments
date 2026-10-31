import { afterEach, expect, test, vi } from 'vitest'
import { cloneSlot } from '../../../src/puck/editor/cloneSlot.js'
import type { Slot } from '../../../src/types/puck.js'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const source: Slot = [{ type: 'Section', props: {
  id: 'section-source', title: 'Keep this', relation: { id: 'document-id' },
  content: [{ type: 'Text', props: { id: 'text-source', text: 'Hello', deeper: [
    { type: 'Button', props: { id: 'button-source', href: '/here' } },
  ] } }],
} }]

function componentIds(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, any>
  return [...(typeof record.type === 'string' ? [record.props.id as string] : []), ...Object.values(value).flatMap(componentIds)]
}

test.each(['crypto', 'no getRandomValues', 'no crypto', 'throwing crypto'] as const)('deep clone with %s', mode => {
  if (mode === 'no getRandomValues') vi.stubGlobal('crypto', {})
  if (mode === 'no crypto') vi.stubGlobal('crypto', undefined)
  if (mode === 'throwing crypto') vi.stubGlobal('crypto', { getRandomValues: () => { throw new Error('unavailable') } })
  const before = JSON.stringify(source)
  const result = cloneSlot(source)
  const ids = componentIds(result)
  expect(ids).toHaveLength(3)
  expect(new Set(ids).size).toBe(3)
  expect(ids.some(id => componentIds(source).includes(id))).toBe(false)
  expect(ids[0]).toMatch(/^Section-/)
  expect(ids[1]).toMatch(/^Text-/)
  expect(ids[2]).toMatch(/^Button-/)
  expect(result[0]!.props.title).toBe('Keep this')
  expect(result[0]!.props.relation).toEqual({ id: 'document-id' })
  expect(result[0]!.props.content[0].props.text).toBe('Hello')
  expect(result[0]!.props.content[0].props.deeper[0].props.href).toBe('/here')
  expect(result[0]!.props.content).not.toBe(source[0]!.props.content)
  expect(JSON.stringify(source)).toBe(before)
  expect(componentIds(cloneSlot(source)).some(id => ids.includes(id))).toBe(false)
})

test('empty slots and constant fallback randomness do not collide', () => {
  vi.stubGlobal('crypto', {})
  vi.spyOn(Math, 'random').mockReturnValue(0)
  expect(cloneSlot([])).toEqual([])
  const ids = [...componentIds(cloneSlot(source)), ...componentIds(cloneSlot(source))]
  expect(new Set(ids).size).toBe(6)
})
