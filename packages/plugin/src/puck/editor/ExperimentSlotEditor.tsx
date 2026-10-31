'use client'

import { createUsePuck, registerOverlayPortal, useGetPuck, type ComponentConfig } from '@puckeditor/core'
import { useEffect, useId, useState } from 'react'
import type { ArmSlot, ExperimentRef, ExperimentSlotProps } from '../../types/puck.js'
import { pickerCopy } from '../copy.js'
import { experimentSlotDefaultProps, experimentSlotFields, experimentSlotLabel } from '../slotConfig.js'
import { bannerFor, tabsFor, type EditorExperiment } from './editor.model.js'
import { cloneSlot } from './cloneSlot.js'
import { CreateExperimentDrawer } from './CreateExperimentDrawer.js'
import { editorCopy } from './copy.js'

const usePuckSelector = createUsePuck()
// Public Puck registration enables native controls inside the editor canvas.
const registerControls = (element: HTMLDivElement | null) => registerOverlayPortal(element, { disableDrag: true })
type RenderProps = Parameters<ComponentConfig<ExperimentSlotProps>['render']>[0]

function isExperiment(value: unknown): value is EditorExperiment {
  if (!value || typeof value !== 'object') return false
  const doc = value as Record<string, unknown>
  return typeof doc.name === 'string' && typeof doc.status === 'string' && Object.hasOwn(pickerCopy.statuses, doc.status) &&
    Array.isArray(doc.arms) && doc.arms.every(arm => arm && typeof arm === 'object' &&
      (Object.hasOwn(editorCopy.labels, arm.key) || arm.key === 'holdout') &&
      ['control', 'variant', 'holdout'].includes(arm.kind) && typeof arm.label === 'string')
}

function EditorRender(props: RenderProps) {
  const getPuck = useGetPuck()
  const tabId = useId()
  const experimentId = props.experiment?.id
  const [loaded, setLoaded] = useState<{ id: typeof experimentId; doc?: EditorExperiment; error?: boolean }>()
  const [active, setActive] = useState<{ id: typeof experimentId; slot: ArmSlot }>()
  const [creating, setCreating] = useState(false)
  const selected = usePuckSelector(state => state.selectedItem?.props.id === props.id)
  const originalEmpty = usePuckSelector(state => {
    const content: unknown = state.selectedItem?.props.control
    return state.selectedItem?.props.id !== props.id || !Array.isArray(content) || content.length === 0
  })

  useEffect(() => {
    if (experimentId === undefined) return
    const controller = new AbortController()
    let current = true
    async function load() {
      try {
        const response = await fetch(`/api/xp-experiments/${encodeURIComponent(experimentId!)}?depth=0`, {
          credentials: 'include', signal: controller.signal,
        })
        if (!response.ok) throw new Error('load')
        const doc: unknown = await response.json()
        if (!isExperiment(doc)) throw new Error('document')
        if (current) setLoaded({ id: experimentId, doc })
      } catch {
        if (current) setLoaded({ id: experimentId, error: true })
      }
    }
    void load()
    return () => { current = false; controller.abort() }
  }, [experimentId])

  const result = experimentId === undefined || loaded?.id !== experimentId ? undefined : loaded
  const experiment = result?.doc
  const tabs = tabsFor(experiment)
  const activeSlot = active && active.id === experimentId ? active.slot : undefined
  const slot = tabs.find(tab => tab.slot === activeSlot)?.slot ?? tabs[0]?.slot ?? 'control'
  const Slot = props[slot]
  const winnerKey = experiment?.decision?.winnerArm
  const winner = tabs.find(tab => tab.slot === winnerKey)?.label

  function copyTo(variant: ArmSlot) {
    const { selectedItem: item, dispatch, getSelectorForId } = getPuck()
    if (!item || item.props.id !== props.id || !Array.isArray(item.props.control) || !item.props.control.length) return
    const selector = getSelectorForId(props.id)
    if (!selector) return
    dispatch({ type: 'replace', destinationIndex: selector.index, destinationZone: selector.zone,
      data: { ...item, props: { ...item.props, [variant]: cloneSlot(item.props.control) } },
    })
  }

  function bind(experiment: ExperimentRef) {
    const { getItemById, dispatch, getSelectorForId } = getPuck()
    const item = getItemById(props.id), selector = getSelectorForId(props.id)
    if (!item || !selector) return
    dispatch({ type: 'replace', destinationIndex: selector.index, destinationZone: selector.zone,
      data: { ...item, props: { ...item.props, experiment } },
    })
  }

  return <section style={{ border: '1px solid #aaa', padding: 12 }}>
    <div ref={registerControls}>
    <p role="status">{experimentId === undefined ? bannerFor() : result?.error ? editorCopy.loadError : experiment ? bannerFor(experiment.status, winner) : editorCopy.loading}</p>
    <button type="button" disabled={!selected} onClick={() => setCreating(true)}>{editorCopy.createLabel}</button>
    {creating ? <CreateExperimentDrawer onCreate={bind} onClose={() => setCreating(false)} /> : null}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBlock: 8 }}>
      {tabs.filter(tab => tab.slot !== 'control').map(tab => <button key={tab.slot} type="button" disabled={originalEmpty} onClick={() => copyTo(tab.slot)}>{editorCopy.copy(tab.label)}</button>)}
    </div>
    <div role="tablist" aria-label={editorCopy.tabs} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
      {tabs.map((tab, index) => <button key={tab.slot} type="button" role="tab" id={`${tabId}-${tab.slot}`} aria-selected={tab.slot === slot} tabIndex={tab.slot === slot ? 0 : -1} aria-controls={`${tabId}-panel`} onClick={() => setActive({ id: experimentId, slot: tab.slot })} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : undefined
        if (next === undefined) return
        event.preventDefault()
        setActive({ id: experimentId, slot: tabs[next]!.slot })
        const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
        buttons?.[next]?.focus()
      }}>{tab.label}</button>)}
    </div>
    </div>
    <div role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-${slot}`}><Slot /></div>
  </section>
}

export const ExperimentSlotEditor: ComponentConfig<ExperimentSlotProps> = {
  label: experimentSlotLabel,
  fields: experimentSlotFields,
  defaultProps: experimentSlotDefaultProps,
  render: EditorRender,
}
