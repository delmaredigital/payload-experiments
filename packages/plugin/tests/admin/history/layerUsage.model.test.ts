import { expect, test } from 'vitest'
import { layerUsage } from '../../../src/admin/layerUsage.model.js'

test('only running and decided experiments use slices, with a unique total', () => {
  expect(layerUsage([
    { name: 'One', status: 'running', layerSlices: [1, 2, 2, 3] },
    { name: 'Two', status: 'decided', layerSlices: [3, 4] },
    { name: 'Draft', status: 'draft', layerSlices: [5] },
    { name: 'Stopped', status: 'stopped', layerSlices: [6] },
    { name: 'Archived', status: 'archived', layerSlices: [7] },
  ])).toEqual({ used: 4, free: 96, rows: [
    { name: 'One', status: 'running', slices: 3 }, { name: 'Two', status: 'decided', slices: 2 },
  ] })
})
test('empty layers and missing claims leave all slices free', () => {
  expect(layerUsage([])).toEqual({ used: 0, free: 100, rows: [] })
  expect(layerUsage([{ name: 'Done', status: 'decided', layerSlices: null }]).used).toBe(0)
  expect(layerUsage([{ name: 'Full', status: 'running', layerSlices: Array.from({ length: 100 }, (_, i) => i) }]).free).toBe(0)
})
