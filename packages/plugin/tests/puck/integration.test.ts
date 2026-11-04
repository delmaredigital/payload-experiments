import { beforeEach, expect, test, vi } from 'vitest'
import { experimentsPuck, EXPERIMENT_SLOT_TYPE } from '../../src/exports/puck.js'
import { experimentsPuckEditor } from '../../src/exports/puckEditor.js'
import { createExperimentSlot } from '../../src/puck/ExperimentSlot.js'
import { createExperimentSlotEditor } from '../../src/puck/editor/ExperimentSlotEditor.js'
import { experimentOutlinePlugin } from '../../src/puck/editor/experimentOutlinePlugin.js'

vi.mock('../../src/puck/ExperimentSlot.js', { spy: true })
vi.mock('../../src/puck/editor/ExperimentSlotEditor.js', { spy: true })
vi.mock('../../src/puck/editor/experimentOutlinePlugin.js', { spy: true })
beforeEach(() => vi.clearAllMocks())

const categories = { experiments: { title: 'A/B tests', components: [EXPERIMENT_SLOT_TYPE] } }

test('render integration has one block and category, with no plugins key', () => {
  const integration = experimentsPuck()
  expect(Object.keys(integration).sort()).toEqual(['categories', 'components', 'name'])
  expect(integration.name).toBe('experiments')
  expect(Object.keys(integration.components)).toEqual([EXPERIMENT_SLOT_TYPE])
  expect(integration.categories).toEqual(categories)
  expect(integration).not.toHaveProperty('plugins')
})

test('editor integration adds only the outline plugin', () => {
  const integration = experimentsPuckEditor()
  expect(Object.keys(integration).sort()).toEqual(['categories', 'components', 'name', 'plugins'])
  expect(integration.name).toBe('experiments')
  expect(Object.keys(integration.components)).toEqual([EXPERIMENT_SLOT_TYPE])
  expect(integration.categories).toEqual(categories)
  expect(integration.plugins?.map(plugin => plugin.name)).toEqual(['experiment-outline'])
  expect(experimentOutlinePlugin).toHaveBeenCalledExactlyOnceWith()
  expect(integration.plugins?.[0]).toBe(vi.mocked(experimentOutlinePlugin).mock.results[0]?.value)
})

test.each([undefined, { admin: '/manage', api: '/content-api' }])('render passes routes %j to the existing factory', routes => {
  const integration = experimentsPuck({ routes })
  expect(createExperimentSlot).toHaveBeenCalledExactlyOnceWith({ routes })
  expect(integration.components[EXPERIMENT_SLOT_TYPE]).toBe(vi.mocked(createExperimentSlot).mock.results[0]?.value)
})

test.each([{}, { routes: { admin: '/manage', api: '/content-api' }, accent: '#1f3a68' }])('editor passes options %j to the existing factory', options => {
  const integration = experimentsPuckEditor(options)
  expect(createExperimentSlotEditor).toHaveBeenCalledExactlyOnceWith({ routes: options.routes, accent: options.accent })
  expect(integration.components[EXPERIMENT_SLOT_TYPE]).toBe(vi.mocked(createExperimentSlotEditor).mock.results[0]?.value)
})
