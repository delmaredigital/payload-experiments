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
import './editor.css'

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
  // A non-empty variant is only overwritten after an explicit second confirmation.
  const [confirming, setConfirming] = useState<ArmSlot | null>(null)
  const pageTitle = usePuckSelector(state => typeof state.appState.data.root.props?.title === 'string' ? state.appState.data.root.props.title : '')
  const selected = usePuckSelector(state => state.selectedItem?.props.id === props.id)
  const originalEmpty = usePuckSelector(state => {
    const content: unknown = state.getItemById(props.id)?.props.control
    return !Array.isArray(content) || content.length === 0
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
  const slotEmpty = usePuckSelector(state => {
    const content: unknown = state.getItemById(props.id)?.props[slot]
    return !Array.isArray(content) || content.length === 0
  })
  const Slot = props[slot]
  const winnerKey = experiment?.decision?.winnerArm
  const winner = tabs.find(tab => tab.slot === winnerKey)?.label

  function requestCopy(variant: ArmSlot) {
    const { selectedItem: item } = getPuck()
    const target = item?.props.id === props.id ? item.props[variant] : undefined
    if (Array.isArray(target) && target.length) setConfirming(variant)
    else copyTo(variant)
  }

  function copyTo(variant: ArmSlot) {
    setConfirming(null)
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

  return <section className="xp-slot-root xp-slot-editor">
    <div className="xp-slot-chrome" ref={registerControls}>
    <header className="xp-slot-header">
      <h3 className="xp-slot-title">{experiment?.name ?? pickerCopy.label}</h3>
      {experiment ? <span className="xp-slot-status" data-status={experiment.status}>{pickerCopy.statuses[experiment.status]}</span> : null}
      <div className="xp-slot-actions">
        <button className="xp-slot-button xp-slot-button-primary" type="button" disabled={!selected} onClick={() => setCreating(true)}>{editorCopy.createLabel}</button>
        {/* Configurable admin routes are owed on ADM-11, alongside the existing /api prefix. */}
        {experiment?.status === 'draft' ? <a className="xp-slot-button" href={`/admin/experiments/${encodeURIComponent(String(experimentId))}`}>{editorCopy.setup}</a> : null}
      </div>
    </header>
    <p className={experiment?.status === 'running' ? 'xp-slot-notice xp-slot-warning' : 'xp-slot-notice'} role="status">
      {experiment?.status === 'running' ? <svg className="xp-slot-warning-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3 2 21h20L12 3Z" /><path d="M12 9v5m0 3v1" /></svg> : null}
      {experimentId === undefined ? bannerFor() : result?.error ? editorCopy.loadError : experiment ? bannerFor(experiment.status, winner) : editorCopy.loading}
    </p>
    {creating ? <CreateExperimentDrawer initialName={pageTitle} onCreate={bind} onClose={() => setCreating(false)} /> : null}
    {confirming ? <div className="xp-slot-confirm" role="alert"><p className="xp-slot-notice">{editorCopy.replaceConfirm(tabs.find(tab => tab.slot === confirming)?.label ?? confirming)}</p>
      <div className="xp-slot-actions">
        <button className="xp-slot-button xp-slot-button-primary" type="button" onClick={() => copyTo(confirming)}>{editorCopy.replace}</button>
        <button className="xp-slot-button" type="button" onClick={() => setConfirming(null)}>{editorCopy.cancel}</button>
      </div></div> : null}
    <div className="xp-slot-toolbar">
    <div className="xp-slot-tabs" role="tablist" aria-label={editorCopy.tabs}>
      {tabs.map((tab, index) => <button className="xp-slot-tab" key={tab.slot} type="button" role="tab" id={`${tabId}-${tab.slot}`} aria-selected={tab.slot === slot} tabIndex={tab.slot === slot ? 0 : -1} aria-controls={`${tabId}-panel`} onClick={() => setActive({ id: experimentId, slot: tab.slot })} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : undefined
        if (next === undefined) return
        event.preventDefault()
        setActive({ id: experimentId, slot: tabs[next]!.slot })
        const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
        buttons?.[next]?.focus()
      }}>{tab.label}</button>)}
    </div>
    {slot !== 'control' ? <div className="xp-slot-actions">
      <button className="xp-slot-button" type="button" disabled={!selected || originalEmpty} onClick={() => requestCopy(slot)}>{editorCopy.copy}</button>
    </div> : null}
    </div>
    </div>
    <div className={slotEmpty ? 'xp-slot-panel xp-slot-panel-empty' : 'xp-slot-panel'} role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-${slot}`}>
      <Slot className="xp-slot-drop-target" />
      {slotEmpty ? <span className="xp-slot-drop-label">{editorCopy.dropZone(slot)}</span> : null}
    </div>
  </section>
}

export const ExperimentSlotEditor: ComponentConfig<ExperimentSlotProps> = {
  label: experimentSlotLabel,
  fields: experimentSlotFields,
  defaultProps: experimentSlotDefaultProps,
  render: EditorRender,
}
