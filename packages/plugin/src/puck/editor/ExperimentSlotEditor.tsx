'use client'

import { createUsePuck, registerOverlayPortal, useGetPuck, type ComponentConfig } from '@puckeditor/core'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ArmSlot, ExperimentRef, ExperimentSlotProps } from '../../types/puck.js'
import { Button } from '../../ui/Button.js'
import { StatusChip } from '../../ui/StatusChip.js'
import { Banner } from '../../ui/Banner.js'
import { Tabs } from '../../ui/Tabs.js'
import { accentVariables, deriveAccent, validateAccent } from '../../ui/accent.js'
import { createExperimentSlotField } from '../experimentSlotField.js'
import { resolvePuckRoutes, type PuckRoutes } from '../routes.js'
import { PuckHostProvider, usePuckRoutes } from '../hostContext.js'
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

function EditorRender(props: RenderProps & { accent?: ReturnType<typeof deriveAccent> }) {
  const getPuck = useGetPuck()
  const { admin, api } = usePuckRoutes()
  const root = useRef<HTMLElement>(null)
  const [mode, setMode] = useState<'light' | 'dark'>('light')
  useEffect(() => {
    const node = root.current
    if (!node || !props.accent) return
    const update = () => setMode(node.closest('[data-theme="dark"], .dark') ? 'dark' : 'light')
    update()
    const observer = new MutationObserver(update)
    for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
      observer.observe(ancestor, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    }
    return () => observer.disconnect()
  }, [props.accent])
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
        const response = await fetch(`${api}/xp-experiments/${encodeURIComponent(experimentId!)}?depth=0`, {
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
  }, [experimentId, api])

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

  return <section ref={root} className="xp-slot-root xp-slot-editor" style={props.accent ? accentVariables(props.accent[mode]) as CSSProperties : undefined}>
    <div className="xp-slot-chrome" ref={registerControls}>
      <header className="xp-slot-header">
        <h3 className="xp-slot-title">{experiment?.name ?? experimentSlotLabel}</h3>
        {experiment ? <StatusChip status={experiment.status} /> : experimentId === undefined ? <span className="xp-ui-status">{editorCopy.notSetUp}</span> : null}
      </header>
      <Banner tone={result?.error ? 'error' : experiment?.status === 'running' ? 'warning' : 'info'}>
        {experimentId === undefined ? bannerFor() : result?.error ? editorCopy.loadError : experiment ? bannerFor(experiment.status, winner) : editorCopy.loading}
      </Banner>
      <div className="xp-ui-button-group">
        {experimentId === undefined ? <Button variant="primary" disabled={!selected} onClick={() => setCreating(true)}>{editorCopy.createLabel}</Button> : null}
        {experiment ? <Button href={`${admin}/experiments/${encodeURIComponent(String(experimentId))}${experiment.status === 'draft' ? '' : '/results'}`} target="_blank" rel="noopener noreferrer">{experiment.status === 'draft' ? editorCopy.setup : editorCopy.viewResults}</Button> : null}
        {slot !== 'control' ? <Button disabled={!selected || originalEmpty} onClick={() => requestCopy(slot)}>{editorCopy.copy}</Button> : null}
      </div>
      {creating ? <CreateExperimentDrawer initialName={pageTitle} onCreate={bind} onClose={() => setCreating(false)} /> : null}
      {confirming ? <div className="xp-slot-confirm" role="alert"><p>{editorCopy.replaceConfirm(tabs.find(tab => tab.slot === confirming)?.label ?? confirming)}</p>
        <div className="xp-ui-button-group">
          <Button variant="primary" onClick={() => copyTo(confirming)}>{editorCopy.replace}</Button>
          <Button onClick={() => setConfirming(null)}>{editorCopy.cancel}</Button>
        </div></div> : null}
    </div>
    <Tabs label={editorCopy.tabs} value={slot} tabListRef={registerControls} onChange={value => setActive({ id: experimentId, slot: value as ArmSlot })}
      items={tabs.map(tab => ({ id: tab.slot, label: tab.label, content: tab.slot === slot ?
        <div className={slotEmpty ? 'xp-slot-panel xp-slot-panel-empty' : 'xp-slot-panel'}>
          <Slot className="xp-slot-drop-target" />
          {slotEmpty ? <span className="xp-slot-drop-label">{editorCopy.dropZone(slot)}</span> : null}
        </div> : null }))} />
  </section>
}

export function createExperimentSlotEditor({ routes: inputRoutes, accent }: { routes?: PuckRoutes; accent?: string } = {}): ComponentConfig<ExperimentSlotProps> {
  validateAccent(accent)
  const sets = accent ? deriveAccent(accent) : undefined
  const routes = resolvePuckRoutes(inputRoutes)
  return {
    label: experimentSlotLabel,
    fields: { ...experimentSlotFields, experiment: createExperimentSlotField({ routes }) },
    defaultProps: experimentSlotDefaultProps,
    render: props => <PuckHostProvider routes={routes}><EditorRender {...props} accent={sets} /></PuckHostProvider>,
  }
}

export const ExperimentSlotEditor = createExperimentSlotEditor()
