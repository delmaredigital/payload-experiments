'use client'

import { createUsePuck, registerOverlayPortal, useGetPuck, type ComponentConfig } from '@puckeditor/core'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ArmSlot, ExperimentRef, ExperimentSlotProps } from '../../types/puck.js'
import type { Arm } from '../../types/contracts.js'
import type { PreflightResult } from '../../types/endpoints.js'
import { Button } from '../../ui/Button.js'
import { StatusChip } from '../../ui/StatusChip.js'
import { Banner } from '../../ui/Banner.js'
import { Tabs } from '../../ui/Tabs.js'
import { Dialog } from '../../ui/Dialog.js'
import { accentVariables, deriveAccent, validateAccent } from '../../ui/accent.js'
import { createExperimentSlotField } from '../experimentSlotField.js'
import { resolvePuckRoutes, type PuckRoutes } from '../routes.js'
import { PuckHostProvider, usePuckRoutes } from '../hostContext.js'
import { pickerCopy, slotLabels } from '../copy.js'
import { experimentSlotDefaultProps, experimentSlotFields, experimentSlotLabel } from '../slotConfig.js'
import { armsFromBlock, bannerFor, isSharedTest, tabsFor, type EditorExperiment } from './editor.model.js'
import { cloneSlot } from './cloneSlot.js'
import { CreateExperimentDrawer } from './CreateExperimentDrawer.js'
import { editorCopy } from './copy.js'
import { acquireArms, loadArms, setArms, useArms } from './armsCache.js'
import { AddVariant, RemoveVersion, VersionActions, VersionWeights, useArmWrites } from './VersionBuilder.js'
import { ResultsReadout } from './ResultsReadout.js'
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
  const bindingKey = JSON.stringify([api, props.id, experimentId])
  const binding = useRef({ key: bindingKey, live: true })
  binding.current.key = bindingKey
  useEffect(() => { binding.current.live = true; return () => { binding.current.live = false } }, [])
  const isCurrentBinding = () => binding.current.live && binding.current.key === bindingKey
  const knownArms = useArms(experimentId)
  const [loaded, setLoaded] = useState<{ id: typeof experimentId; doc?: EditorExperiment; error?: boolean; shared?: boolean }>()
  const [active, setActive] = useState<{ id: typeof experimentId; slot: ArmSlot }>()
  const [openMenu, setOpenMenu] = useState<ArmSlot | null>(null)
  const [clearError, setClearError] = useState<{ key: string; message: string } | null>(null)
  const [creating, setCreating] = useState<{ key: string } | null>(null)
  const [detaching, setDetaching] = useState<string | null>(null)
  // A non-empty variant is only overwritten after an explicit second confirmation.
  const [confirming, setConfirming] = useState<ArmSlot | null>(null)
  // Keep a failed removal open even if the recovery read no longer contains that version.
  const [removing, setRemoving] = useState<{ key: string; arm: EditorExperiment['arms'][number] } | null>(null)
  const pageTitle = usePuckSelector(state => typeof state.appState.data.root.props?.title === 'string' ? state.appState.data.root.props.title : '')
  // Selection only changes the chrome's appearance; actions always resolve this block by id.
  const isSelected = usePuckSelector(state => state.selectedItem?.props.id === props.id)
  const originalEmpty = usePuckSelector(state => {
    const content: unknown = state.getItemById(props.id)?.props.control
    return !Array.isArray(content) || content.length === 0
  })
  const orphanSlots = usePuckSelector(state => {
    const item = state.getItemById(props.id)
    return (['variantA', 'variantB', 'variantC'] as const).filter(slot => {
      const content: unknown = item?.props[slot]
      return knownArms && !knownArms.arms.includes(slot) && Array.isArray(content) && content.length > 0
    }).join(',')
  }).split(',').filter(Boolean) as ArmSlot[]

  useEffect(() => {
    if (experimentId === undefined) return
    const controller = new AbortController()
    let current = true
    let request = 0
    const releaseArms = acquireArms(experimentId)
    async function load() {
      const revision = ++request
      try {
        const doc = await loadArms(experimentId!, async signal => {
          const response = await fetch(`${api}/xp-experiments/${encodeURIComponent(experimentId!)}?depth=0`, {
            credentials: 'include', signal,
          })
          if (!response.ok) throw new Error('load')
          const doc: unknown = await response.json()
          if (!isExperiment(doc)) throw new Error('document')
          return doc
        }, controller.signal)
        if (current && revision === request) {
          setLoaded({ id: experimentId, doc })
        }
        // Reuse the same access-checked placement read as the test page. A failed check
        // leaves placement sharing unknown and does not hide the block's other actions.
        if (!current || revision !== request) return
        try {
          const response = await fetch(`${api}/xp/experiments/${encodeURIComponent(experimentId!)}/preflight`, {
            credentials: 'include', cache: 'no-store', signal: controller.signal,
          })
          if (!response.ok) return
          const data = await response.json() as PreflightResult
          if (current && revision === request && Array.isArray(data.placements)) {
            setLoaded(value => value && value.id === experimentId ? { ...value, shared: isSharedTest(data.placements) } : value)
          }
        } catch { /* Placement sharing is optional; the document read above remains usable. */ }
      } catch {
        if (current && revision === request) {
          setLoaded({ id: experimentId, error: true })
        }
      }
    }
    void load()
    // The linked test opens in another tab; refresh this same document source on return.
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { current = false; controller.abort(); releaseArms(); document.removeEventListener('visibilitychange', onVisible) }
  }, [experimentId, api])

  const result = experimentId === undefined || loaded?.id !== experimentId ? undefined : loaded
  const experiment = result?.doc
  const editable = experiment?.status === 'draft' || experiment?.status === 'stopped'
  const [removed, setRemoved] = useState<{ key: string; revision: number } | null>(null)
  useEffect(() => {
    // Dialog cleanup must close the native modal before an outside tab can receive focus.
    if (removed?.key === bindingKey) root.current?.querySelector<HTMLButtonElement>('[role="tab"]')?.focus()
  }, [removed, bindingKey])
  const writes = useArmWrites(`${api}/xp-experiments/${encodeURIComponent(String(experimentId))}`, doc => {
    setArms(experimentId!, doc.arms.map(arm => arm.key))
    if (isCurrentBinding()) setLoaded(value => ({ ...value, id: experimentId, doc }))
  }, isCurrentBinding, () => setClearError(null))
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

  function selectBlock() {
    const { dispatch, getSelectorForId } = getPuck()
    const itemSelector = getSelectorForId(props.id)
    if (itemSelector) dispatch({ type: 'setUi', ui: { itemSelector } })
  }

  function requestCopy(variant: ArmSlot) {
    const item = getPuck().getItemById(props.id)
    const target = item?.props[variant]
    if (Array.isArray(target) && target.length) setConfirming(variant)
    else copyTo(variant)
  }

  function copyTo(variant: ArmSlot) {
    setConfirming(null)
    const { getItemById, dispatch, getSelectorForId } = getPuck()
    const item = getItemById(props.id)
    if (!item || !Array.isArray(item.props.control) || !item.props.control.length) return
    const selector = getSelectorForId(props.id)
    if (!selector) return
    dispatch({ type: 'replace', destinationIndex: selector.index, destinationZone: selector.zone,
      data: { ...item, props: { ...item.props, [variant]: cloneSlot(item.props.control) } },
    })
  }

  function removeContent(slot: ArmSlot) {
    if (!isCurrentBinding()) return
    const { getItemById, dispatch, getSelectorForId } = getPuck()
    const item = getItemById(props.id), selector = getSelectorForId(props.id)
    if (!item || !selector) { setClearError({ key: bindingKey, message: editorCopy.removeUncleared }); return }
    setClearError(null)
    dispatch({ type: 'replace', destinationIndex: selector.index, destinationZone: selector.zone,
      data: { ...item, props: { ...item.props, [slot]: [] } },
    })
    setRemoved(current => ({ key: bindingKey, revision: (current?.revision ?? 0) + 1 }))
    setActive({ id: experimentId, slot: 'control' })
  }

  function bind(experiment: ExperimentRef | null) {
    if (!isCurrentBinding()) return
    const { getItemById, dispatch, getSelectorForId } = getPuck()
    const item = getItemById(props.id), selector = getSelectorForId(props.id)
    if (!item || !selector) return
    dispatch({ type: 'replace', destinationIndex: selector.index, destinationZone: selector.zone,
      data: { ...item, props: { ...item.props, experiment } },
    })
  }

  async function newTestArms(): Promise<Arm[]> {
    if (!isCurrentBinding()) throw new Error('binding')
    // Another placement can rename or add a version while this dialog is open.
    const response = await fetch(`${api}/xp-experiments/${encodeURIComponent(String(experimentId))}?depth=0`, { credentials: 'include', cache: 'no-store' })
    if (!response.ok) throw new Error('load')
    const doc: unknown = await response.json()
    const item = getPuck().getItemById(props.id)
    if (!isCurrentBinding() || !isExperiment(doc) || !item) throw new Error('binding')
    return armsFromBlock(doc, item.props)
  }

  const newTestButton = experimentId !== undefined ? <Button disabled={!experiment} onClick={() => setCreating({ key: bindingKey })}>{editorCopy.newTest}</Button> : null

  return <section ref={root} className="xp-slot-root xp-slot-editor" style={props.accent ? accentVariables(props.accent[mode]) as CSSProperties : undefined}>
    <div className="xp-slot-chrome" ref={registerControls} data-selected={isSelected} role="group" aria-label={experimentSlotLabel} tabIndex={0}
      onClick={event => {
        // Use DOM methods on the event target: the canvas can live in another window.
        const target = event.target as Element
        if (target.closest('button, a, input, select, textarea, label, summary, [role="button"], [role="link"], [role="tab"], [role="menu"], [role="menuitem"], [contenteditable]:not([contenteditable="false"])')) return
        selectBlock()
      }}
      onKeyDown={event => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          selectBlock()
        }
      }}>
      <header className="xp-slot-header">
        <h3 className="xp-slot-title">{experiment?.name ?? experimentSlotLabel}</h3>
        {experiment ? <StatusChip status={experiment.status} /> : experimentId === undefined ? <span className="xp-ui-status">{editorCopy.notSetUp}</span> : null}
      </header>
      <Banner tone={result?.error ? 'error' : experiment?.status === 'running' ? 'warning' : 'info'}>
        {experimentId === undefined ? bannerFor() : result?.error ? editorCopy.loadError : experiment ? bannerFor(experiment.status, winner) : editorCopy.loading}
      </Banner>
      {orphanSlots.map(slot => <Banner key={slot} tone="warning">{editorCopy.orphan(slotLabels[slot])}</Banner>)}
      {result?.shared ? <Banner tone="info" action={newTestButton}>{editorCopy.sharedTest}</Banner> : null}
      <div className="xp-ui-button-group">
        {experimentId === undefined ? <Button variant="primary" onClick={() => setCreating({ key: bindingKey })}>{editorCopy.createLabel}</Button> : null}
        {experiment ? <Button href={`${admin}/experiments/${encodeURIComponent(String(experimentId))}${experiment.status === 'draft' ? '' : '/results'}`} target="_blank" rel="noopener noreferrer">{experiment.status === 'draft' ? editorCopy.setup : editorCopy.viewResults}</Button> : null}
        {experimentId !== undefined && experiment?.status !== 'draft' ? <Button href={`${admin}/experiments/${encodeURIComponent(String(experimentId))}`} target="_blank" rel="noopener noreferrer">{editorCopy.openTest}</Button> : null}
        {!result?.shared ? newTestButton : null}
        {experimentId !== undefined ? <Button onClick={() => setDetaching(bindingKey)}>{editorCopy.detach}</Button> : null}
        {experiment && editable ? <AddVariant experiment={experiment} writes={writes} onSelect={slot => { if (isCurrentBinding()) setActive({ id: experimentId, slot }) }} /> : null}
      </div>
      {experiment && !editable ? <p className="xp-ui-help">{editorCopy.locked[experiment.status as keyof typeof editorCopy.locked]}</p> : null}
      {experiment && editable ? <VersionWeights key={`weights-${experimentId}`} experiment={experiment} writes={writes} /> : null}
      {writes.error ? <p role="alert" className="xp-ui-error">{writes.error}</p> : null}
      {clearError?.key === bindingKey ? <p role="alert" className="xp-ui-error">{clearError.message}</p> : null}
      {removed?.key === bindingKey ? <p className="xp-ui-help">{editorCopy.removed}</p> : null}
      {experiment && experiment.status !== 'draft' ? <ResultsReadout key={`results-${experimentId}`} id={experimentId!} api={api} experiment={experiment} /> : null}
      {removing?.key === bindingKey ? <RemoveVersion arm={removing.arm} writes={writes} onRemove={removeContent} onClose={() => setRemoving(null)} /> : null}
      {creating?.key === bindingKey ? <CreateExperimentDrawer initialName={pageTitle} arms={experimentId === undefined ? undefined : newTestArms}
        label={experimentId === undefined ? editorCopy.createLabel : editorCopy.newTest} onCreate={bind} onClose={() => setCreating(null)} /> : null}
      {detaching === bindingKey ? <Dialog open title={editorCopy.detachTitle} initialFocus="cancel" onClose={() => setDetaching(null)}>
        <div className="xp-slot-drawer"><p>{editorCopy.detachHelp}</p><div className="xp-ui-button-group">
          <Button data-dialog-cancel onClick={() => setDetaching(null)}>{editorCopy.cancel}</Button>
          <Button onClick={() => { bind(null); setDetaching(null) }}>{editorCopy.detach}</Button>
        </div></div>
      </Dialog> : null}
      {confirming ? <div className="xp-slot-confirm" role="alert"><p>{editorCopy.replaceConfirm(tabs.find(tab => tab.slot === confirming)?.label ?? confirming)}</p>
        <div className="xp-ui-button-group">
          <Button variant="primary" onClick={() => copyTo(confirming)}>{editorCopy.replace}</Button>
          <Button onClick={() => setConfirming(null)}>{editorCopy.cancel}</Button>
        </div></div> : null}
    </div>
    <Tabs label={editorCopy.tabs} value={slot} tabListRef={registerControls} onChange={value => { setOpenMenu(null); setActive({ id: experimentId, slot: value as ArmSlot }) }}
      items={tabs.map(tab => ({ id: tab.slot, label: tab.label, actions: experiment ? <VersionActions
        key={`${experimentId}-${tab.slot}`} arm={experiment.arms.find(arm => arm.key === tab.slot)!} writes={writes} editable={editable} open={openMenu === tab.slot} onOpenChange={open => setOpenMenu(open ? tab.slot : null)}
        canCopy={!originalEmpty} onCopy={requestCopy} onRequestRemove={() => setRemoving({ key: bindingKey, arm: experiment.arms.find(arm => arm.key === tab.slot)! })} /> : undefined, content: tab.slot === slot ?
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
