'use client'

import { createPortal } from 'react-dom'
import { createUsePuck, useGetPuck, FieldGroup, type ComponentConfig } from '@puckeditor/core'
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
import { readPreflight } from '../../testSurface/readPreflight.js'
import { classifyReadinessRead, type ReadinessRead } from '../../testSurface/readinessRead.js'
import { useReadinessPolling } from '../../testSurface/useReadinessPolling.js'
import { PlacementNotice } from './PlacementNotice.js'
import { QuickTestActions } from './QuickTestActions.js'
import type { TestDocApi } from '../../testSurface/surface/contracts.js'
import type { TestDocument } from '../../testSurface/surface/testDocument.model.js'
import { BlockerList } from '../../testSurface/surface/readiness/BlockerList.js'
import { resolvePuckRoutes, type PuckRoutes } from '../routes.js'
import { PuckHostProvider, usePuckRoutes } from '../hostContext.js'
import { pickerCopy, slotLabels } from '../copy.js'
import { experimentSlotDefaultProps, experimentSlotFields, experimentSlotLabel } from '../slotConfig.js'
import { armsFromBlock, bannerFor, currentPuckDocument, isSharedTest, tabsFor, type EditorExperiment } from './editor.model.js'
import { cloneSlot, countSlotBlocks } from './cloneSlot.js'
import { openCreateExperimentDrawer } from './CreateExperimentDrawer.js'
import { editorCopy } from './copy.js'
import { acquireArms, loadArms, publishExperiment, useArms } from './armsCache.js'
import { AddVariant, RemoveVersion, VersionName, VersionWeights, useArmWrites, type WeightEdits } from './VersionBuilder.js'
import { ResultsReadout } from './ResultsReadout.js'
import { EditorControls } from './EditorControls.js'
import { acquirePlacements, cachedPreflight, cachedReadinessRead, placementsPending, placementsBlocking, placementReadError, invalidatePlacements, refreshPlacements, focusPlacements } from './placementsCache.js'
import { sidebarReadinessBlockers, editorPlacementMessage } from '../../testSurface/surface/editorPlacement.js'
import type { PreflightResult } from '../../types/endpoints.js'
import { localPlacements } from './localPlacements.js'
import { usePlacementNotice } from './usePlacementNotice.js'
import { useEditorSurface } from './editorSurface.js'
import { createBlockTest, CreateRefused } from './createTest.js'
import { ConfigureTestControl, openConfigureTestDrawer } from './ConfigureTestDrawer.js'
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
  const [preflight, setPreflight] = useState<{ id: typeof experimentId; value?: PreflightResult; pending: boolean; blocking: boolean }>()
  const [placements, setPlacements] = useState<{ id: typeof experimentId; value: PreflightResult['placements'] | undefined }>()
  const [loaded, setLoaded] = useState<{ id: typeof experimentId; doc?: EditorExperiment; error?: boolean; forbidden?: boolean; missing?: boolean; shared?: boolean; read?: ReadinessRead }>()
  const [documentPending, setDocumentPending] = useState(false)
  const documentFailures = useRef({ key: bindingKey, failures: 0 })
  if (documentFailures.current.key !== bindingKey) documentFailures.current = { key: bindingKey, failures: 0 }
  useReadinessPolling(loaded?.id === experimentId ? loaded?.read : undefined, () => setReadAttempt(value => value + 1), true, documentPending)
  const [active, setActive] = useState<{ id: typeof experimentId; slot: ArmSlot }>()
  const [choosing, setChoosing] = useState(false)
  const [clearError, setClearError] = useState<{ key: string; message: string } | null>(null)
  const setupBusy = useRef(false)
  const [settingUp, setSettingUp] = useState(false)
  const [setupError, setSetupError] = useState('')
  const configuration = useRef<ReturnType<typeof openConfigureTestDrawer>>(undefined)
  useEffect(() => () => configuration.current?.close(), [])
  const creation = useRef<ReturnType<typeof openCreateExperimentDrawer>>(undefined)
  useEffect(() => () => creation.current?.closeIfIdle(), [])
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
  const testVersions = (knownArms?.arms.length ? knownArms.arms : undefined) ?? (loaded?.id === experimentId ? loaded?.doc?.arms.map(arm => arm.key) : undefined)
  const orphanSlots = usePuckSelector(state => {
    const item = state.getItemById(props.id)
    return (['variantA', 'variantB', 'variantC'] as const).filter(slot => {
      const content: unknown = item?.props[slot]
      return testVersions && !testVersions.includes(slot) && Array.isArray(content) && content.length > 0
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
      setDocumentPending(true)
      try {
        const doc = await loadArms(experimentId!, async signal => {
          const { response, body } = await readPreflight(boundedSignal => fetch(`${api}/xp-experiments/${encodeURIComponent(experimentId!)}?depth=0`, {
            credentials: 'include', signal: boundedSignal,
          }), signal)
          if (!response.ok) throw new TestReadError(response.status)
          const doc: unknown = body
          if (!isExperiment(doc)) throw new Error('document')
          return doc
        }, controller.signal)
        if (current && revision === request) {
          documentFailures.current.failures = 0
          setLoaded(value => ({ id: experimentId, doc, shared: value?.id === experimentId ? value?.shared : undefined }))
        }
      } catch (cause) {
        if (current && revision === request) {
          const read = classifyReadinessRead(cause instanceof TestReadError ? cause.status : 0, undefined, ++documentFailures.current.failures, { kind: 'document', surface: 'editor' })
          const forbidden = read.loadState === 'forbidden'
          const missing = read.loadState === 'missing'
          setLoaded(value => ({ id: experimentId, read, forbidden, missing, error: !forbidden && !missing, shared: value?.id === experimentId ? value?.shared : undefined }))
        }
      } finally { if (current && revision === request) setDocumentPending(false) }
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
      setPreflight({ id: experimentId, value: cachedPreflight(api, experimentId), pending: placementsPending(api, experimentId), blocking: placementsBlocking(api, experimentId) })
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
  const originalLabel = tabs.find(tab => tab.slot === 'control')?.label ?? slotLabels.control
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

  function bind(experiment: ExperimentRef) {
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
    if (experimentId === undefined) return armsFromBlock({ arms: [defaultArms('block')[0]!] }, item.props)
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
      onCreate: bind,
    })
  }
  async function setUpTest() {
    if (setupBusy.current || !canManage || experimentId !== undefined || !root.current) return
    const source = root.current
    setupBusy.current = true; setSettingUp(true); setSetupError('')
    try {
      const created = await createBlockTest(api, pageTitle, await newTestArms())
      if (bind(created)) configuration.current = openConfigureTestDrawer(source, { admin, api }, created.id)
      else creation.current = openCreateExperimentDrawer(source, { admin, api }, { created, onCreate: () => false })
    } catch (cause) {
      if (isCurrentBinding()) setSetupError(cause instanceof CreateRefused ? cause.message : editorCopy.createError)
    } finally { setupBusy.current = false; if (isCurrentBinding()) setSettingUp(false) }
  }
  const placementMessage = editorPlacementMessage(placements && placements.id === experimentId ? placements.value : undefined, currentPuckDocument(window.location.pathname, admin, placements && placements.id === experimentId ? placements.value : undefined), experiment?.status)

  const currentPreflight = preflight && preflight.id === experimentId && Array.isArray(preflight.value?.checks) ? preflight.value : null
  const editorPage = currentPuckDocument(window.location.pathname, admin, placements?.value)
  const surface = access.surface ? { ...access.surface, editorPage, apiRoute: api, adminRoute: admin, editorPlacementMessage: placementMessage } : undefined
  const quickTest: TestDocApi = {
    doc: experiment ? { ...experiment, id: experimentId!, kind: 'block' } as TestDocument : null,
    preflight: currentPreflight, preflightRead: experimentId === undefined ? undefined : cachedReadinessRead(api, experimentId), preflightError: !currentPreflight ? placementReadError(api, experimentId!) ?? null : null, preflightPending: documentPending || !preflight || preflight.id !== experimentId || preflight.pending,
    hasUnsaved: writes.busy || Object.keys(weightEdits).length > 0, saving: writes.busy ? 'saving' : 'idle', stale: false, errors: {},
    chosenPages: {}, loadState: 'ready', stage: () => {}, commit: async () => {}, choosePage: async () => {},
    refreshPreflight: async supersede => { if (experimentId !== undefined) { if (supersede) invalidatePlacements(api, experimentId); await refreshPlacements(api, experimentId) } },
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
  const placementNotice = quickTest.preflightRead?.message ?? placementMessage
  usePlacementNotice(api, experimentId, canManage ? placementNotice : undefined)
  const placementNoticeView = <PlacementNotice read={quickTest.preflightRead} message={placementMessage} running={experiment?.status === 'running'} onRetry={() => { if (experimentId !== undefined) void refreshPlacements(api, experimentId) }} />
  const sidebarBlockers = surface ? sidebarReadinessBlockers(quickTest, surface) : []

  const leftoverControls = experiment && orphanSlots.length ? <LeftoverVersions slots={orphanSlots} active={slot} dragging={dragging} experiment={experiment} writes={writes} canManage={canManage}
    countBlocks={slot => countSlotBlocks(getPuck().getItemById(props.id)?.props[slot])} onDelete={removeContent} onSelect={slot => { if (isCurrentBinding()) setActive({ id: experimentId, slot }) }} /> : null

  const documentRead = result?.read ? classifyReadinessRead(result.read.status, undefined, documentFailures.current.failures, { kind: 'document', surface: 'editor', resultsOnly }) : undefined
  const accessNotice = documentRead ? documentRead.retry ? <Banner tone="error" action={<Button onClick={() => setReadAttempt(value => value + 1)}>{editorCopy.retrySetup}</Button>}>{documentRead.message}</Banner> : <p className="xp-ui-help">{documentRead.message}</p>
        : !access.surface && !access.error ? <p className="xp-ui-help" role="status">{editorCopy.loading}</p> : access.error === 'unavailable' ? <p className="xp-ui-help">{editorCopy.controlsUnavailable} <Button onClick={access.retry}>{editorCopy.retrySetup}</Button></p>
        : experimentId === undefined && resultsOnly ? <p className="xp-ui-help">{editorCopy.setupForbidden}</p>
        : experimentId === undefined && noAccess ? <p className="xp-ui-help">{pickerCopy.forbiddenUnbound}</p>
        : experimentId !== undefined && (noAccess || unavailable || resultsOnly) ? <p className="xp-ui-help">{resultsOnly ? pickerCopy.resultsOnly : pickerCopy.forbidden}</p> : <Banner tone={experiment?.status === 'running' ? 'warning' : 'info'}>
        {experimentId === undefined ? bannerFor() : experiment ? bannerFor(experiment.status, winner, originalLabel) : editorCopy.loading}
      </Banner>

  const removeDialog = removing?.key === bindingKey ? <RemoveVersion count={countSlotBlocks(getPuck().getItemById(props.id)?.props[removing.arm.key])} shared={locallyShared ? true : result?.shared} arm={removing.arm} writes={writes} onRemove={removeContent} onClose={() => setRemoving(null)} /> : null

  return <section ref={root} className="xp-slot-root xp-slot-editor" style={props.accent ? accentVariables(props.accent[mode]) as CSSProperties : undefined}>
    {sidebar ? <>
      {createPortal(<div onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
        <section aria-label={editorCopy.testGroup}><FieldGroup label={editorCopy.testGroup} collapsible={false}>
          {experiment ? <><strong>{experiment.name}</strong><StatusChip status={experiment.status} /></> : null}
          {accessNotice}
          {shared ? <Banner tone="info">{editorCopy.sharedTest}</Banner> : null}
          {canManage ? <>{placementNoticeView}{experiment?.status === 'draft' || experiment?.status === 'stopped' ? <BlockerList steps={sidebarBlockers} /> : null}</> : null}
          {experimentId !== undefined && access.surface && !result?.missing && !noAccess && (!unavailable || resultsOnly) ? <ConfigureTestControl id={experimentId} routes={{ admin, api }} /> : null}
          {canManage && experiment && surface ? <QuickTestActions key={`${experimentId}/${experiment.status}`} test={quickTest} surface={surface} /> : null}
          {experimentId === undefined && canManage ? <Button variant="primary" busy={settingUp} disabled={settingUp} onClick={() => void setUpTest()}>{editorCopy.createLabel}</Button> : null}
          {experimentId === undefined && canManage ? <Button disabled={settingUp} onClick={() => setChoosing(true)}>{editorCopy.existingTest}</Button> : null}
          {setupError && experimentId === undefined ? <p role="alert">{setupError}</p> : null}
        </FieldGroup></section>
      </div>, sidebar.test)}
      {createPortal(<div onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
        {experiment && access.surface && !noAccess ? <section aria-label={editorCopy.versionsGroup}><FieldGroup label={editorCopy.versionsGroup} collapsible={false}>
          {!editable ? <p className="xp-ui-help">{canManage ? editorCopy.locked[experiment.status as keyof typeof editorCopy.locked] ?? editorCopy.lockedGeneric : editorCopy.readOnlyVersions}</p> : null}
          <VersionWeights edits={weightEdits} setEdits={setWeightEdits} groupId={props.id} splitIntent={splitIntent} experiment={experiment} writes={writes} editable={editable}
            beforeSplit={<>{leftoverControls}{editable ? <AddVariant experiment={experiment} writes={writes} onSelect={slot => { if (isCurrentBinding()) setActive({ id: experimentId, slot }) }} /> : null}</>}
            renderRow={(arm, input) => <div className="xp-slot-version-group" data-active={slot === arm.key} role="group" aria-label={arm.label}>
              <FieldGroup variant="card" collapsible={false}>
                <Button variant="quiet" aria-pressed={slot === arm.key} disabled={arm.kind === 'holdout' || dragging} onClick={() => setActive({ id: experimentId, slot: arm.key as ArmSlot })}>{arm.label}</Button>
                <VersionName key={`${experimentId}-${arm.key}`} arm={arm} writes={writes} editable={editable} />
                {input}
                {arm.kind === 'variant' ? <><Button disabled={writes.busy || originalEmpty} onClick={() => requestCopy(arm.key as ArmSlot)}>{editorCopy.copy(originalLabel)}</Button>{originalEmpty ? <p className="xp-ui-help">{editorCopy.copyEmpty(originalLabel)}</p> : null}</> : null}
                {editable && arm.kind !== 'control' ? <Button disabled={writes.busy} onClick={() => setRemoving({ key: bindingKey, arm })}>{editorCopy.removeVersion}</Button> : null}
              </FieldGroup>
            </div>} />
        </FieldGroup></section> : null}
        {access.surface?.canManage && experimentId !== undefined ? <FieldGroup label={editorCopy.moreGroup} defaultExpanded={false}>
          <Button onClick={() => setChoosing(true)}>{editorCopy.differentTest}</Button>
        </FieldGroup> : null}
        {writes.busy ? <p role="status">{editorCopy.savingVersions}</p> : null}
        {writes.error ? <p role="alert">{writes.error}</p> : null}
        {clearError?.key === bindingKey ? <p role="alert">{clearError.message}</p> : null}
        {removed?.key === bindingKey && removed.contentRemoved ? <p>{editorCopy.removed}</p> : null}
        {experiment && experiment.status !== 'draft' ? <ResultsReadout key={`results-${experimentId}`} id={experimentId!} api={api} experiment={experiment} /> : null}
        {confirming ? <div role="alert"><p>{editorCopy.replaceConfirm(tabs.find(tab => tab.slot === confirming)?.label ?? confirming, originalLabel)}</p><div className="xp-ui-button-group">
          <Button variant="primary" onClick={() => copyTo(confirming)}>{editorCopy.replace}</Button>
          <Button onClick={() => setConfirming(null)}>{editorCopy.cancel}</Button>
        </div></div> : null}
        {removeDialog}
        {choosing ? <Dialog open title={experimentId === undefined ? editorCopy.existingTest : editorCopy.differentTest} onClose={() => setChoosing(false)}><div className="xp-slot-drawer">
          <ExperimentPicker value={props.experiment ?? null} allowEmpty={false} onChange={value => { if (value && bind(value)) setChoosing(false) }} />
          <Button disabled={experimentId !== undefined && !experiment} onClick={() => { setChoosing(false); createFromBlock() }}>{editorCopy.createAnother}</Button>
          <Button onClick={() => setChoosing(false)}>{editorCopy.cancel}</Button>
        </div></Dialog> : null}
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
        <h3 className="xp-slot-title" title={experimentId === undefined ? editorCopy.unbound : experiment?.name ?? experimentSlotLabel}>{experimentId === undefined ? editorCopy.unbound : experiment?.name ?? experimentSlotLabel}</h3>
        {experiment ? <StatusChip status={experiment.status} /> : null}
      </header>
      {experimentId === undefined && canManage ? null : accessNotice}
      {shared ? <Banner tone="info">{editorCopy.sharedTest}</Banner> : null}
      {canManage ? placementNoticeView : null}
      {setupError && experimentId === undefined ? <p role="alert">{setupError}</p> : null}
      {experimentId === undefined && canManage ? <Button variant="primary" busy={settingUp} disabled={settingUp} onClick={() => void setUpTest()}>{editorCopy.createLabel}</Button> : null}
    </EditorControls>
    <Tabs disabled={dragging} label={editorCopy.tabs} value={slot} renderHeader={children => <EditorControls className="xp-ui-tabs-header">{children}</EditorControls>} onChange={value => setActive({ id: experimentId, slot: value as ArmSlot })}
      items={tabs.map(tab => ({ id: tab.slot, label: tab.label, content: tab.slot === slot ?
        <div className={slotEmpty ? 'xp-slot-panel xp-slot-panel-empty' : 'xp-slot-panel'}>
          <Slot className="xp-slot-drop-target" />
          {slotEmpty ? <span className="xp-slot-drop-label">{editorCopy.dropZone(tabs.find(tab => tab.slot === slot)?.label ?? slotLabels[slot])}</span> : null}
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
      render: () => <PuckHostProvider routes={routes}><TestSidebarField /></PuckHostProvider>,
    } },
    defaultProps: experimentSlotDefaultProps,
    render: props => <PuckHostProvider routes={routes}><EditorRender {...props} accent={sets} /></PuckHostProvider>,
  }
}

export const ExperimentSlotEditor = createExperimentSlotEditor()
