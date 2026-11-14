'use client'

import { createPortal } from 'react-dom'
import { createUsePuck, useGetPuck, type ComponentConfig } from '@puckeditor/core'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ArmSlot, ExperimentRef, ExperimentSlotProps } from '../../types/puck.js'
import { defaultArms } from '../../arms/model.js'
import { readExperiment } from './armWrites.js'
import { publishOutlineVersion } from './outlineVersion.js'
import { LeftoverVersions } from './LeftoverVersions.js'
import type { Arm } from '../../types/contracts.js'
import { Button } from '../../ui/Button.js'
import { StatusChip } from '../../ui/StatusChip.js'
import { Banner } from '../../ui/Banner.js'
import { Tabs } from '../../ui/Tabs.js'
import { Dialog } from '../../ui/Dialog.js'
import { accentVariables, deriveAccent, validateAccent } from '../../ui/accent.js'
import { ExperimentPicker } from '../ExperimentPicker.js'
import { TestSidebarField, useSidebarTargets } from './sidebar.js'
import { QuickTestActions } from './QuickTestActions.js'
import type { TestDocApi } from '../../testSurface/surface/contracts.js'
import type { TestDocument } from '../../testSurface/surface/testDocument.model.js'
import { blockingSteps, pageReadinessContext } from '../../testSurface/surface/readiness/readiness.model.js'
import { READINESS_COPY } from '../../testSurface/copy/readiness.js'
import { resolvePuckRoutes, type PuckRoutes } from '../routes.js'
import { PuckHostProvider, usePuckRoutes } from '../hostContext.js'
import { pickerCopy, slotLabels } from '../copy.js'
import { experimentSlotDefaultProps, experimentSlotFields, experimentSlotLabel } from '../slotConfig.js'
import { armsFromBlock, bannerFor, currentPuckDocument, isSharedTest, tabsFor, type EditorExperiment } from './editor.model.js'
import { cloneSlot, countSlotBlocks } from './cloneSlot.js'
import { openCreateExperimentDrawer } from './CreateExperimentDrawer.js'
import { editorCopy } from './copy.js'
import { acquireArms, loadArms, publishExperiment, useArms } from './armsCache.js'
import { AddVariant, RemoveVersion, VersionActions, VersionWeights, useArmWrites, type WeightEdits } from './VersionBuilder.js'
import { ResultsReadout } from './ResultsReadout.js'
import { EditorControls } from './EditorControls.js'
import { acquirePlacements, cachedPreflight, placementsPending, invalidatePlacements, refreshPlacements, focusPlacements } from './placementsCache.js'
import { editorPlacementMessage } from '../../testSurface/surface/editorPlacement.js'
import type { PreflightResult } from '../../types/endpoints.js'
import { localPlacements } from './localPlacements.js'
import { usePlacementNotice } from './usePlacementNotice.js'
import { useEditorSurface } from './editorSurface.js'
import { ConfigureTestControl } from './ConfigureTestDrawer.js'
import './editor.css'

const usePuckSelector = createUsePuck()
type RenderProps = Parameters<ComponentConfig<ExperimentSlotProps>['render']>[0]

class TestReadError extends Error {
  constructor(readonly status: number) { super('load') }
}

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
  const sidebar = useSidebarTargets(props.id)
  const { admin, api } = usePuckRoutes()
  const access = useEditorSurface(api)
  const root = useRef<HTMLElement>(null)
  const [readAttempt, setReadAttempt] = useState(0)
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
  const [preflight, setPreflight] = useState<{ id: typeof experimentId; value?: PreflightResult; pending: boolean }>()
  const [placements, setPlacements] = useState<{ id: typeof experimentId; value: PreflightResult['placements'] | undefined }>()
  const [loaded, setLoaded] = useState<{ id: typeof experimentId; doc?: EditorExperiment; error?: boolean; forbidden?: boolean; missing?: boolean; shared?: boolean }>()
  const [active, setActive] = useState<{ id: typeof experimentId; slot: ArmSlot }>()
  const [openMenu, setOpenMenu] = useState<string | null>(null)
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
  const dragging = usePuckSelector(state => state.appState.ui?.isDragging ?? false)
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
          if (!response.ok) throw new TestReadError(response.status)
          const doc: unknown = await response.json()
          if (!isExperiment(doc)) throw new Error('document')
          return doc
        }, controller.signal)
        if (current && revision === request) {
          setLoaded(value => ({ id: experimentId, doc, shared: value?.id === experimentId ? value?.shared : undefined }))
        }
      } catch (cause) {
        if (current && revision === request) {
          const forbidden = cause instanceof TestReadError && (cause.status === 401 || cause.status === 403)
          const missing = cause instanceof TestReadError && cause.status === 404
          setLoaded(value => ({ id: experimentId, forbidden, missing, error: !forbidden && !missing, shared: value?.id === experimentId ? value?.shared : undefined }))
        }
      }
    }
    void load()
    // The linked test opens in another tab; refresh this same document source on return.
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { current = false; controller.abort(); releaseArms(); document.removeEventListener('visibilitychange', onVisible) }
  }, [experimentId, api, readAttempt])

  const cachedExperiment = loaded?.id === experimentId && !loaded?.forbidden && !loaded?.missing ? knownArms?.doc : undefined
  const status = cachedExperiment?.status ?? (loaded?.id === experimentId ? loaded?.doc?.status : undefined)
  useEffect(() => {
    if (experimentId === undefined || !status || !access.surface?.canManage) return
    const release = acquirePlacements(api, experimentId, placements => {
      // Retain guidance only while revalidating; failures must show their own message.
      setPlacements(current => placements === undefined && placementsPending(api, experimentId) && current?.id === experimentId ? current : { id: experimentId, value: placements })
      setPreflight({ id: experimentId, value: cachedPreflight(api, experimentId), pending: placementsPending(api, experimentId) })
      const shared = placements === undefined ? undefined : isSharedTest(placements, currentPuckDocument(window.location.pathname, admin, placements))
      setLoaded(value => ({ ...(value?.id === experimentId ? value : {}), id: experimentId, shared: shared ?? (value?.id === experimentId ? value.shared : undefined) }))
    })
    const focus = () => { void focusPlacements(api, experimentId) }
    window.addEventListener('focus', focus)
    return () => { release(); window.removeEventListener('focus', focus) }
  }, [api, admin, experimentId, status, access.surface?.canManage])

  const locallyShared = usePuckSelector(state => experimentId !== undefined &&
    (localPlacements(state.appState.data, state.config).get(String(experimentId))?.size ?? 0) > 1)

  const result = experimentId === undefined || loaded?.id !== experimentId ? undefined : loaded
  const shared = locallyShared || result?.shared === true
  const experiment = cachedExperiment ?? result?.doc
  const noAccess = access.error === 'forbidden' || !!access.surface && !access.surface.canManage && !access.surface.canReadResults
  const resultsOnly = access.surface?.canReadResults === true && !access.surface.canManage
  const unavailable = result?.forbidden || result?.missing
  const canManage = access.surface?.canManage === true && !unavailable
  const editable = canManage && (experiment?.status === 'draft' || experiment?.status === 'stopped')
  const [removed, setRemoved] = useState<{ key: string; revision: number; contentRemoved: boolean } | null>(null)
  useEffect(() => {
    // Dialog cleanup must close the native modal before an outside tab can receive focus.
    if (removed?.key === bindingKey) root.current?.querySelector<HTMLButtonElement>('[role="tab"]')?.focus()
  }, [removed, bindingKey])
  const splitIntent = useRef(false)
  const [weightEdits, setWeightEdits] = useState<WeightEdits>({})
  useEffect(() => { setWeightEdits({}); splitIntent.current = false }, [bindingKey, status])
  const writes = useArmWrites(`${api}/xp-experiments/${encodeURIComponent(String(experimentId))}`, doc => {
    publishExperiment(experimentId!, doc)
    if (isCurrentBinding()) setLoaded(value => ({ id: experimentId, doc, shared: value?.id === experimentId ? value?.shared : undefined }))
  }, isCurrentBinding, () => setClearError(null), () => { if (isCurrentBinding()) setWeightEdits({}); invalidatePlacements(api, experimentId!) })
  // The slot arrays belong to the page; reading the test is unnecessary to edit them.
  const pageSlots = usePuckSelector(state => (['control', 'variantA', 'variantB', 'variantC'] as const).filter(slot => {
    const content: unknown = state.getItemById(props.id)?.props[slot]
    return slot === 'control' || Array.isArray(content) && content.length > 0
  }).join(','))
  // Keep a page-observed version reachable while its last child is replaced.
  const observedSlots = useRef({ key: bindingKey, slots: new Set<string>() })
  if (observedSlots.current.key !== bindingKey) observedSlots.current = { key: bindingKey, slots: new Set() }
  for (const slot of pageSlots.split(',')) observedSlots.current.slots.add(slot)
  const tabs = unavailable || !experiment ? [...observedSlots.current.slots].sort((a, b) => a.localeCompare(b)).map(slot => ({ slot: slot as ArmSlot, label: slotLabels[slot as ArmSlot] })) : [...tabsFor(experiment), ...orphanSlots.map(slot => ({ slot, label: editorCopy.outsideTest(slotLabels[slot]) }))]
  const activeSlot = active && active.id === experimentId ? active.slot : undefined
  const slot = tabs.find(tab => tab.slot === activeSlot)?.slot ?? tabs[0]?.slot ?? 'control'
  const slotEmpty = usePuckSelector(state => {
    const content: unknown = state.getItemById(props.id)?.props[slot]
    return !Array.isArray(content) || content.length === 0
  })
  useEffect(() => {
    publishOutlineVersion(getPuck, props.id, slot)
    return () => publishOutlineVersion(getPuck, props.id)
  }, [getPuck, props.id, slot])
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
    if (countSlotBlocks(item.props[slot]) === 0) {
      setRemoved(current => ({ key: bindingKey, revision: (current?.revision ?? 0) + 1, contentRemoved: false }))
      setActive({ id: experimentId, slot: 'control' })
      return
    }
    dispatch({ type: 'replace', destinationIndex: selector.index, destinationZone: selector.zone,
      data: { ...item, props: { ...item.props, [slot]: [] } },
    })
    setRemoved(current => ({ key: bindingKey, revision: (current?.revision ?? 0) + 1, contentRemoved: true }))
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
    const item = getPuck().getItemById(props.id)
    if (!item) throw new Error('binding')
    if (experimentId === undefined) return armsFromBlock({ arms: defaultArms('block') }, item.props)
    // Another placement can rename or add a version while this dialog is open.
    const response = await fetch(`${api}/xp-experiments/${encodeURIComponent(String(experimentId))}?depth=0`, { credentials: 'include', cache: 'no-store' })
    if (!response.ok) throw new Error('load')
    const doc: unknown = await response.json()
    const latest = getPuck().getItemById(props.id)
    if (!isCurrentBinding() || !isExperiment(doc) || !latest) throw new Error('binding')
    return armsFromBlock(doc, latest.props)
  }

  function createFromBlock() {
    if (!root.current) return
    creation.current = openCreateExperimentDrawer(root.current, { admin, api }, {
      initialName: pageTitle,
      arms: newTestArms,
      label: experimentId === undefined ? editorCopy.createLabel : editorCopy.newTest,
      onCreate: bind,
    })
  }
  const canDetach = !!result?.forbidden || !!result?.missing || !!experiment && (experiment.status !== 'running' || result?.shared !== undefined && shared)
  const [checkingDetach, setCheckingDetach] = useState(false)
  const detachBusy = useRef(false)
  async function requestDetach(confirm = false) {
    if (detachBusy.current || experimentId === undefined) return
    detachBusy.current = true
    setCheckingDetach(true)
    setClearError(null)
    try {
      const response = await fetch(`${api}/xp-experiments/${encodeURIComponent(String(experimentId))}?depth=0`, { credentials: 'include', cache: 'no-store' })
      const current: unknown = response.ok ? await response.json() : null
      if (!isCurrentBinding()) return
      if (![401, 403, 404].includes(response.status) && !isExperiment(current)) { setClearError({ key: bindingKey, message: editorCopy.placementsError }); setDetaching(null); return }
      if (isExperiment(current)) publishExperiment(experimentId, current)
      if (isExperiment(current) && current.status === 'running') {
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
    } catch {
      if (isCurrentBinding()) { setClearError({ key: bindingKey, message: editorCopy.placementsError }); setDetaching(null) }
    } finally { detachBusy.current = false; setCheckingDetach(false) }
  }
  const placementMessage = editorPlacementMessage(placements && placements.id === experimentId ? placements.value : undefined, currentPuckDocument(window.location.pathname, admin, placements && placements.id === experimentId ? placements.value : undefined), experiment?.status)
  usePlacementNotice(api, experimentId, canManage ? placementMessage : undefined)
  const newTestButton = experimentId !== undefined && canManage ? <Button disabled={!experiment} onClick={createFromBlock}>{editorCopy.newTest}</Button> : null

  const currentPreflight = preflight && preflight.id === experimentId && Array.isArray(preflight.value?.checks) ? preflight.value : null
  const surface = access.surface ? { ...access.surface, apiRoute: api, adminRoute: admin, editorPlacementMessage: placementMessage } : undefined
  const quickTest: TestDocApi = {
    doc: experiment ? { ...experiment, id: experimentId!, kind: 'block' } as TestDocument : null,
    preflight: currentPreflight, preflightError: preflight && preflight.id === experimentId && !preflight.pending && !currentPreflight ? READINESS_COPY.checkError : null, preflightPending: !preflight || preflight.id !== experimentId || preflight.pending && !currentPreflight,
    hasUnsaved: writes.busy || Object.keys(weightEdits).length > 0, saving: writes.busy ? 'saving' : 'idle', stale: false, errors: {},
    chosenPages: {}, loadState: 'ready', stage: () => {}, commit: async () => {}, choosePage: async () => {},
    refreshPreflight: async () => { if (experimentId !== undefined) await refreshPlacements(api, experimentId) },
    reload: async () => {
      if (experimentId === undefined) return
      // A transition may succeed without a readable response body; recover its document too.
      publishExperiment(experimentId, await readExperiment(`${api}/xp-experiments/${encodeURIComponent(experimentId)}?depth=0`))
      invalidatePlacements(api, experimentId)
      await refreshPlacements(api, experimentId)
    },
    acceptTransition: result => {
      const doc = (result as { doc?: EditorExperiment } | undefined)?.doc
      if (doc && experimentId !== undefined) publishExperiment(experimentId, doc)
    },
  }
  const blockers = quickTest.doc && surface ? blockingSteps(currentPreflight?.checks ? currentPreflight : null, pageReadinessContext(quickTest.doc, currentPreflight, surface)) : []
  const placementFailure = preflight && preflight.id === experimentId && !preflight.pending && (!preflight.value || preflight.value.checks?.some(check => !check.ok && check.code === 'no-placements' && check.detail !== undefined))
  const placementNotice = placementFailure ? editorCopy.placementsError : placementMessage
  const placementNoticeView = placementNotice ? <Banner tone={experiment?.status === 'running' && !placementFailure ? 'warning' : 'error'} action={placementFailure ? <Button onClick={() => { if (experimentId !== undefined) void refreshPlacements(api, experimentId) }}>{editorCopy.retrySetup}</Button> : undefined}>
    {experiment?.status === 'running' && !placementFailure ? <span aria-hidden="true">⚠ </span> : null}{placementNotice}
  </Banner> : null
  const blockingLine = placementMessage ?? (quickTest.hasUnsaved ? READINESS_COPY.saveFirst : quickTest.preflightError ? READINESS_COPY.checkError : quickTest.preflightPending || !currentPreflight ? READINESS_COPY.checking : blockers.map(step => step.sentence).slice(0, 3).join(' '))
  const leftoverControls = experiment && orphanSlots.length ? <LeftoverVersions slots={orphanSlots} experiment={experiment} writes={writes} canManage={canManage}
    count={slot => countSlotBlocks(getPuck().getItemById(props.id)?.props[slot])} onDelete={removeContent} onSelect={slot => { if (isCurrentBinding()) setActive({ id: experimentId, slot }) }} /> : null

  const accessNotice = result?.missing ? <p className="xp-ui-help">{pickerCopy.unavailable}</p>
        : !access.surface && !access.error ? <p className="xp-ui-help" role="status">{editorCopy.loading}</p> : access.error === 'unavailable' ? <p className="xp-ui-help">{editorCopy.controlsUnavailable} <Button onClick={access.retry}>{editorCopy.retrySetup}</Button></p>
        : experimentId === undefined && resultsOnly ? <p className="xp-ui-help">{editorCopy.setupForbidden}</p>
        : experimentId === undefined && noAccess ? <p className="xp-ui-help">{pickerCopy.forbiddenUnbound}</p>
        : experimentId !== undefined && (noAccess || unavailable || resultsOnly) ? <p className="xp-ui-help">{resultsOnly ? pickerCopy.resultsOnly : pickerCopy.forbidden}</p> : <Banner action={result?.error ? <Button onClick={() => setReadAttempt(value => value + 1)}>{editorCopy.retrySetup}</Button> : undefined} tone={result?.error ? 'error' : experiment?.status === 'running' ? 'warning' : 'info'}>
        {experimentId === undefined ? bannerFor() : result?.error ? editorCopy.loadError : experiment ? bannerFor(experiment.status, winner) : editorCopy.loading}
      </Banner>

  const removeDialog = removing?.key === bindingKey ? <RemoveVersion count={countSlotBlocks(getPuck().getItemById(props.id)?.props[removing.arm.key])} shared={locallyShared ? true : result?.shared} arm={removing.arm} writes={writes} onRemove={removeContent} onClose={() => setRemoving(null)} /> : null

  return <section ref={root} className="xp-slot-root xp-slot-editor" style={props.accent ? accentVariables(props.accent[mode]) as CSSProperties : undefined}>
    {sidebar ? <>
      {createPortal(<div onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}><section aria-label={editorCopy.testGroup}><h4>{editorCopy.testGroup}</h4>
        {access.surface?.canManage ? <ExperimentPicker value={props.experiment ?? null} onChange={sidebar.onChange} /> : null}
        {experiment ? <StatusChip status={experiment.status} /> : experimentId === undefined ? <span className="xp-ui-status">{editorCopy.notSetUp}</span> : null}
        {accessNotice}
        {canManage ? placementNoticeView ?? ((experiment?.status === 'draft' || experiment?.status === 'stopped') && blockingLine ? <p role="status">{READINESS_COPY.beforeStart} {blockingLine}</p> : null) : null}
      </section></div>, sidebar.test)}
      {createPortal(<div onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
        {experiment && canManage ? <section aria-label={editorCopy.versionsGroup}><h4>{editorCopy.versionsGroup}</h4>
          <VersionWeights edits={weightEdits} setEdits={setWeightEdits} groupId={props.id} splitIntent={splitIntent} experiment={experiment} writes={writes} editable={editable} beforeSplit={<>{leftoverControls}{editable ? <AddVariant experiment={experiment} writes={writes} onSelect={slot => { if (isCurrentBinding()) setActive({ id: experimentId, slot }) }} /> : null}</>} actions={arm => <>
            <VersionActions arm={arm} writes={writes} editable={editable} running={experiment.status === 'running'} open={openMenu === `sidebar-${arm.key}`} onOpenChange={open => setOpenMenu(open ? `sidebar-${arm.key}` : null)} canCopy={!originalEmpty} onCopy={requestCopy} onRequestRemove={() => setRemoving({ key: bindingKey, arm })} />
            {editable && arm.kind !== 'control' ? <Button disabled={writes.busy} onClick={() => setRemoving({ key: bindingKey, arm })}>{editorCopy.remove}</Button> : null}
          </>} />
        </section> : null}
        <section aria-label={editorCopy.actionsGroup}><h4>{editorCopy.actionsGroup}</h4>
          {experimentId !== undefined && access.surface && !result?.missing && !noAccess && (!unavailable || resultsOnly) ? <ConfigureTestControl id={experimentId} routes={{ admin, api }} /> : null}
          {canManage && experiment && surface ? <QuickTestActions key={`${experimentId}/${experiment.status}`} test={quickTest} surface={surface} /> : null}
          {experimentId === undefined && canManage ? <Button variant="primary" onClick={createFromBlock}>{editorCopy.createLabel}</Button> : null}
          {writes.error ? <p role="alert">{writes.error}</p> : null}
        </section>
        {removeDialog}
      </div>, sidebar.controls)}
    </> : null}
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
      {accessNotice}
      {leftoverControls}
      {shared ? <Banner tone="info" action={newTestButton}>{editorCopy.sharedTest}</Banner> : null}
      {canManage ? placementNoticeView : null}
      {experimentId !== undefined && canManage && !experiment && !result?.error ? <p className="xp-ui-help">{editorCopy.loadingBeforeNew}</p> : null}
      {checkingDetach ? <p role="status" className="xp-ui-help">{editorCopy.checkingRemoval}</p> : null}
      <div className="xp-ui-button-group">
        {experimentId === undefined && canManage ? <Button variant="primary" onClick={createFromBlock}>{editorCopy.createLabel}</Button> : null}
        {experimentId !== undefined && access.surface && !result?.missing && !noAccess && (!unavailable || resultsOnly) ? <ConfigureTestControl id={experimentId} routes={{ admin, api }} /> : null}
        {!shared ? newTestButton : null}
        {experimentId !== undefined && canDetach ? <Button disabled={checkingDetach} onClick={() => void requestDetach()}>{editorCopy.detach}</Button> : null}
        {experiment && editable ? <AddVariant experiment={experiment} writes={writes} onSelect={slot => { if (isCurrentBinding()) setActive({ id: experimentId, slot }) }} /> : null}
      </div>
      {experiment?.status === 'running' && result?.shared !== undefined && !shared ? <p className="xp-ui-help">{editorCopy.stopToDetach}</p> : null}
      {experiment && !editable ? <p className="xp-ui-help">{editorCopy.locked[experiment.status as keyof typeof editorCopy.locked]}</p> : null}
      {experiment && editable ? <VersionWeights key={`weights-${experimentId}`} edits={weightEdits} setEdits={setWeightEdits} groupId={props.id} splitIntent={splitIntent} experiment={experiment} writes={writes} /> : null}
      {writes.busy ? <p role="status" className="xp-ui-help">{editorCopy.savingVersions}</p> : null}
      {writes.error ? <p role="alert" className="xp-ui-error">{writes.error}</p> : null}
      {clearError?.key === bindingKey && !(placementFailure && clearError.message === editorCopy.placementsError) ? <p role="alert" className="xp-ui-error">{clearError.message}</p> : null}
      {removed?.key === bindingKey && removed.contentRemoved ? <p className="xp-ui-help">{editorCopy.removed}</p> : null}
      {experiment && experiment.status !== 'draft' ? <ResultsReadout key={`results-${experimentId}`} id={experimentId!} api={api} experiment={experiment} /> : null}
      {!sidebar ? removeDialog : null}
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
    <Tabs disabled={dragging} label={editorCopy.tabs} value={slot} renderHeader={children => <EditorControls className="xp-ui-tabs-header">{children}</EditorControls>} onChange={value => { setOpenMenu(null); setActive({ id: experimentId, slot: value as ArmSlot }) }}
      items={tabs.map(tab => ({ id: tab.slot, label: tab.label, actions: experiment?.arms.some(arm => arm.key === tab.slot) ? <VersionActions
        key={`${experimentId}-${tab.slot}`} arm={experiment.arms.find(arm => arm.key === tab.slot)!} writes={writes} editable={editable} running={experiment.status === 'running'} open={openMenu === tab.slot} onOpenChange={open => setOpenMenu(open ? tab.slot : null)}
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
    fields: { ...experimentSlotFields, experiment: { type: 'custom', label: pickerCopy.label,
      render: ({ value, onChange }) => <PuckHostProvider routes={routes}><TestSidebarField onChange={next => {
        if (value) invalidatePlacements(routes.api, value.id)
        if (next) invalidatePlacements(routes.api, next.id)
        onChange(next)
      }} /></PuckHostProvider>,
    } },
    defaultProps: experimentSlotDefaultProps,
    render: props => <PuckHostProvider routes={routes}><EditorRender {...props} accent={sets} /></PuckHostProvider>,
  }
}

export const ExperimentSlotEditor = createExperimentSlotEditor()
