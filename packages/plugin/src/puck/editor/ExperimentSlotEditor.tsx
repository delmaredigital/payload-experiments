'use client'

import { createUsePuck, useGetPuck, type ComponentConfig } from '@puckeditor/core'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ArmSlot, ExperimentRef, ExperimentSlotProps } from '../../types/puck.js'
import type { Arm } from '../../types/contracts.js'
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
import { armsFromBlock, bannerFor, currentPuckDocument, isSharedTest, tabsFor, type EditorExperiment } from './editor.model.js'
import { cloneSlot } from './cloneSlot.js'
import { openCreateExperimentDrawer } from './CreateExperimentDrawer.js'
import { editorCopy } from './copy.js'
import { acquireArms, loadArms, publishExperiment, useArms } from './armsCache.js'
import { AddVariant, RemoveVersion, VersionActions, VersionWeights, useArmWrites } from './VersionBuilder.js'
import { ResultsReadout } from './ResultsReadout.js'
import { EditorControls } from './EditorControls.js'
import { acquirePlacements, invalidatePlacements, refreshPlacements } from './placementsCache.js'
import { localPlacements } from './localPlacements.js'
import { ConfigureTestButton, type EditorTestSurface } from './ConfigureTestDrawer.js'
import './editor.css'

const usePuckSelector = createUsePuck()
type RenderProps = Parameters<ComponentConfig<ExperimentSlotProps>['render']>[0]

function isExperiment(value: unknown): value is EditorExperiment {
  if (!value || typeof value !== 'object') return false
  const doc = value as Record<string, unknown>
  return typeof doc.name === 'string' && typeof doc.status === 'string' && Object.hasOwn(pickerCopy.statuses, doc.status) &&
    Array.isArray(doc.arms) && doc.arms.every(arm => arm && typeof arm === 'object' &&
      (Object.hasOwn(editorCopy.labels, arm.key) || arm.key === 'holdout') &&
      ['control', 'variant', 'holdout'].includes(arm.kind) && typeof arm.label === 'string')
}

function EditorRender(props: RenderProps & { accent?: ReturnType<typeof deriveAccent>; surface?: EditorTestSurface }) {
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
  const creation = useRef<ReturnType<typeof openCreateExperimentDrawer>>(undefined)
  useEffect(() => () => creation.current?.closeIfIdle(), [])
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
          setLoaded(value => ({ id: experimentId, doc, shared: value?.id === experimentId ? value?.shared : undefined }))
        }
      } catch {
        if (current && revision === request) {
          setLoaded(value => ({ id: experimentId, error: true, shared: value?.id === experimentId ? value?.shared : undefined }))
        }
      }
    }
    void load()
    // The linked test opens in another tab; refresh this same document source on return.
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { current = false; controller.abort(); releaseArms(); document.removeEventListener('visibilitychange', onVisible) }
  }, [experimentId, api])

  const cachedExperiment = loaded?.id === experimentId ? knownArms?.doc : undefined
  const status = cachedExperiment?.status ?? (loaded?.id === experimentId ? loaded?.doc?.status : undefined)
  useEffect(() => {
    if (experimentId === undefined || !status) return
    return acquirePlacements(api, experimentId, placements => {
      const shared = placements === undefined ? undefined : isSharedTest(placements, currentPuckDocument(window.location.pathname, admin, placements))
      setLoaded(value => ({ ...(value?.id === experimentId ? value : {}), id: experimentId, shared }))
    }, status === 'running')
  }, [api, admin, experimentId, status])

  const locallyShared = usePuckSelector(state => experimentId !== undefined &&
    (localPlacements(state.appState.data, state.config).get(String(experimentId))?.size ?? 0) > 1)

  const result = experimentId === undefined || loaded?.id !== experimentId ? undefined : loaded
  const shared = locallyShared || result?.shared === true
  const experiment = cachedExperiment ?? result?.doc
  const editable = experiment?.status === 'draft' || experiment?.status === 'stopped'
  const [removed, setRemoved] = useState<{ key: string; revision: number } | null>(null)
  useEffect(() => {
    // Dialog cleanup must close the native modal before an outside tab can receive focus.
    if (removed?.key === bindingKey) root.current?.querySelector<HTMLButtonElement>('[role="tab"]')?.focus()
  }, [removed, bindingKey])
  const writes = useArmWrites(`${api}/xp-experiments/${encodeURIComponent(String(experimentId))}`, doc => {
    publishExperiment(experimentId!, doc)
    if (isCurrentBinding()) setLoaded(value => ({ id: experimentId, doc, shared: value?.id === experimentId ? value?.shared : undefined }))
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
    if (!isCurrentBinding()) return false
    const { getItemById, dispatch, getSelectorForId } = getPuck()
    const item = getItemById(props.id), selector = getSelectorForId(props.id)
    if (!item || !selector || String(item.props.experiment?.id) !== String(experimentId)) return false
    if (experimentId !== undefined) invalidatePlacements(api, experimentId)
    if (experiment) invalidatePlacements(api, experiment.id)
    dispatch({ type: 'replace', destinationIndex: selector.index, destinationZone: selector.zone,
      data: { ...item, props: { ...item.props, experiment } },
    })
    return true
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

  function createFromBlock() {
    if (!root.current) return
    creation.current = openCreateExperimentDrawer(root.current, { admin, api }, {
      initialName: pageTitle,
      arms: experimentId === undefined ? undefined : newTestArms,
      label: experimentId === undefined ? editorCopy.createLabel : editorCopy.newTest,
      onCreate: bind,
    })
  }
  const canDetach = !!experiment && (experiment.status !== 'running' || result?.shared !== undefined && shared)
  const [checkingDetach, setCheckingDetach] = useState(false)
  const detachBusy = useRef(false)
  async function requestDetach(confirm = false) {
    if (detachBusy.current || !experiment || experimentId === undefined) return
    detachBusy.current = true
    setCheckingDetach(true)
    setClearError(null)
    try {
      if (experiment.status === 'running') {
        const placements = await refreshPlacements(api, experimentId)
        if (!isCurrentBinding()) return
        if (!placements) { setClearError({ key: bindingKey, message: editorCopy.placementsError }); setDetaching(null); return }
        const local = getPuck()
        const anotherLocal = (localPlacements(local.appState.data, local.config).get(String(experimentId))?.size ?? 0) > 1
        if (!anotherLocal && !isSharedTest(placements, currentPuckDocument(window.location.pathname, admin, placements))) {
          setClearError({ key: bindingKey, message: editorCopy.stopToDetach }); setDetaching(null); return
        }
      }
      if (!isCurrentBinding()) return
      if (confirm) { bind(null); setDetaching(null) }
      else setDetaching(bindingKey)
    } finally { detachBusy.current = false; setCheckingDetach(false) }
  }
  const newTestButton = experimentId !== undefined ? <Button disabled={!experiment} onClick={createFromBlock}>{editorCopy.newTest}</Button> : null

  return <section ref={root} className="xp-slot-root xp-slot-editor" style={props.accent ? accentVariables(props.accent[mode]) as CSSProperties : undefined}>
    <EditorControls className="xp-slot-chrome" selected={isSelected} onSelect={selectBlock}>
      <header className="xp-slot-header" tabIndex={0} aria-label={editorCopy.selectBlock}
        onKeyDown={event => {
          if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            selectBlock()
          }
        }}>
        <h3 className="xp-slot-title">{experiment?.name ?? experimentSlotLabel}</h3>
        {experiment ? <StatusChip status={experiment.status} /> : experimentId === undefined ? <span className="xp-ui-status">{editorCopy.notSetUp}</span> : null}
      </header>
      <Banner tone={result?.error ? 'error' : experiment?.status === 'running' ? 'warning' : 'info'}>
        {experimentId === undefined ? bannerFor() : result?.error ? editorCopy.loadError : experiment ? bannerFor(experiment.status, winner) : editorCopy.loading}
      </Banner>
      {orphanSlots.map(slot => <Banner key={slot} tone="warning">{editorCopy.orphan(slotLabels[slot])}</Banner>)}
      {shared ? <Banner tone="info" action={newTestButton}>{editorCopy.sharedTest}</Banner> : null}
      <div className="xp-ui-button-group">
        {experimentId === undefined ? <Button variant="primary" onClick={createFromBlock}>{editorCopy.createLabel}</Button> : null}
        {experimentId !== undefined ? <ConfigureTestButton id={experimentId} routes={{ admin, api }} surface={props.surface} /> : null}
        {!shared ? newTestButton : null}
        {experimentId !== undefined && canDetach ? <Button disabled={checkingDetach} onClick={() => void requestDetach()}>{editorCopy.detach}</Button> : null}
        {experiment && editable ? <AddVariant experiment={experiment} writes={writes} onSelect={slot => { if (isCurrentBinding()) setActive({ id: experimentId, slot }) }} /> : null}
      </div>
      {experiment?.status === 'running' && result?.shared !== undefined && !shared ? <p className="xp-ui-help">{editorCopy.stopToDetach}</p> : null}
      {experiment && !editable ? <p className="xp-ui-help">{editorCopy.locked[experiment.status as keyof typeof editorCopy.locked]}</p> : null}
      {experiment && editable ? <VersionWeights key={`weights-${experimentId}`} experiment={experiment} writes={writes} /> : null}
      {writes.error ? <p role="alert" className="xp-ui-error">{writes.error}</p> : null}
      {clearError?.key === bindingKey ? <p role="alert" className="xp-ui-error">{clearError.message}</p> : null}
      {removed?.key === bindingKey ? <p className="xp-ui-help">{editorCopy.removed}</p> : null}
      {experiment && experiment.status !== 'draft' ? <ResultsReadout key={`results-${experimentId}`} id={experimentId!} api={api} experiment={experiment} /> : null}
      {removing?.key === bindingKey ? <RemoveVersion arm={removing.arm} writes={writes} onRemove={removeContent} onClose={() => setRemoving(null)} /> : null}
      {detaching === bindingKey && canDetach ? <Dialog open title={editorCopy.detachTitle} initialFocus="cancel" onClose={() => setDetaching(null)}>
        <div className="xp-slot-drawer"><p>{experiment?.status === 'running' && shared ? editorCopy.detachRunningHelp : editorCopy.detachHelp}</p><div className="xp-ui-button-group">
          <Button data-dialog-cancel onClick={() => setDetaching(null)}>{editorCopy.cancel}</Button>
          <Button disabled={checkingDetach} onClick={() => void requestDetach(true)}>{editorCopy.detach}</Button>
        </div></div>
      </Dialog> : null}
      {confirming ? <div className="xp-slot-confirm" role="alert"><p>{editorCopy.replaceConfirm(tabs.find(tab => tab.slot === confirming)?.label ?? confirming)}</p>
        <div className="xp-ui-button-group">
          <Button variant="primary" onClick={() => copyTo(confirming)}>{editorCopy.replace}</Button>
          <Button onClick={() => setConfirming(null)}>{editorCopy.cancel}</Button>
        </div></div> : null}
    </EditorControls>
    <Tabs label={editorCopy.tabs} value={slot} renderHeader={children => <EditorControls className="xp-ui-tabs-header">{children}</EditorControls>} onChange={value => { setOpenMenu(null); setActive({ id: experimentId, slot: value as ArmSlot }) }}
      items={tabs.map(tab => ({ id: tab.slot, label: tab.label, actions: experiment ? <VersionActions
        key={`${experimentId}-${tab.slot}`} arm={experiment.arms.find(arm => arm.key === tab.slot)!} writes={writes} editable={editable} open={openMenu === tab.slot} onOpenChange={open => setOpenMenu(open ? tab.slot : null)}
        canCopy={!originalEmpty} onCopy={requestCopy} onRequestRemove={() => setRemoving({ key: bindingKey, arm: experiment.arms.find(arm => arm.key === tab.slot)! })} /> : undefined, content: tab.slot === slot ?
        <div className={slotEmpty ? 'xp-slot-panel xp-slot-panel-empty' : 'xp-slot-panel'}>
          <Slot className="xp-slot-drop-target" />
          {slotEmpty ? <span className="xp-slot-drop-label">{editorCopy.dropZone(slot)}</span> : null}
        </div> : null }))} />
  </section>
}

export function createExperimentSlotEditor({ routes: inputRoutes, accent, surface }: { routes?: PuckRoutes; accent?: string; surface?: EditorTestSurface } = {}): ComponentConfig<ExperimentSlotProps> {
  validateAccent(accent)
  const sets = accent ? deriveAccent(accent) : undefined
  const routes = resolvePuckRoutes(inputRoutes)
  return {
    label: experimentSlotLabel,
    fields: { ...experimentSlotFields, experiment: createExperimentSlotField({ routes, renderActions: test => <ConfigureTestButton id={test.id} routes={routes} surface={surface} />, onBind: (previous, next) => { if (previous) invalidatePlacements(routes.api, previous.id); if (next) invalidatePlacements(routes.api, next.id) } }) },
    defaultProps: experimentSlotDefaultProps,
    render: props => <PuckHostProvider routes={routes}><EditorRender {...props} accent={sets} surface={surface} /></PuckHostProvider>,
  }
}

export const ExperimentSlotEditor = createExperimentSlotEditor()
