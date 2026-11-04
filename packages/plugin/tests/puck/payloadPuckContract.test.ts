import type { Config } from '@puckeditor/core'
import { createElement } from 'react'
import { mergeConfigs, type PuckIntegration } from '@delmaredigital/payload-puck/config'
import type { PuckIntegration as EditorPuckIntegration } from '@delmaredigital/payload-puck/client'
import { expect, test, vi } from 'vitest'
import { experimentsPuck, EXPERIMENT_SLOT_TYPE } from '../../src/exports/puck.js'
import { experimentsPuckEditor } from '../../src/exports/puckEditor.js'

test('both integrations satisfy the published render and client contracts', () => {
  const render: PuckIntegration = experimentsPuck() satisfies PuckIntegration
  const editor: EditorPuckIntegration = experimentsPuckEditor() satisfies EditorPuckIntegration
  expect(render.name).toBe('experiments')
  expect(editor.name).toBe('experiments')
  expect(editor.plugins?.map(plugin => plugin.name)).toEqual(['experiment-outline'])
})

test('mergeConfigs includes the slot and category', () => {
  const integration = experimentsPuck()
  const base: Config = { components: {} }
  const config = mergeConfigs({ base, integrations: [integration] })
  expect(config.components[EXPERIMENT_SLOT_TYPE]).toBe(integration.components[EXPERIMENT_SLOT_TYPE])
  expect(config.categories?.experiments).toEqual({ title: 'A/B tests', components: [EXPERIMENT_SLOT_TYPE] })
})

test('a host component with the slot key wins', () => {
  const host = { render: () => createElement('div') }
  const base: Config = { components: { [EXPERIMENT_SLOT_TYPE]: host } }
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const config = mergeConfigs({ base, integrations: [experimentsPuck()] })
    expect(config.components[EXPERIMENT_SLOT_TYPE]).toBe(host)
    expect(config.categories?.experiments?.components).toEqual([EXPERIMENT_SLOT_TYPE])
  } finally { warning.mockRestore() }
})
