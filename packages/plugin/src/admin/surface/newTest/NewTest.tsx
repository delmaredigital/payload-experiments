'use client'

import { fetchAllDocs } from '../../../lib/fetchAllDocs.js'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation.js'
import { formatAdminURL } from 'payload/shared'
import type { DocId, UnitType } from '../../../types/contracts.js'
import type { TestsSurfaceProps } from '../../../types/surface.js'
import type { SurfaceProps } from '../contracts.js'
import { NEW_TEST_COPY as C } from '../../copy/newTest.js'
import { CreateRefused, createTest } from '../../../puck/editor/createTest.js'
import { PageWizard } from './PageWizard.js'
import './newTest.css'

type Layer = { id: DocId; name: string }

export function NewTest({ surface, pages }: { surface: SurfaceProps; pages?: TestsSurfaceProps['pages'] }) {
  const router = useRouter()
  const [step, setStep] = useState<'kind' | 'block' | 'setting' | 'name'>('kind')
  const [kind, setKind] = useState<'flag' | 'page'>('flag')
  const [created, setCreated] = useState<DocId>()
  const [pointId, setPointId] = useState('')
  const point = surface.flagPoints.find(item => item.id === pointId)
  const [unitType, setUnitType] = useState<UnitType>('visitor')
  const [name, setName] = useState('')
  const [hypothesis, setHypothesis] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [layers, setLayers] = useState<Layer[]>([])
  const [layer, setLayer] = useState<DocId>()
  const [layerState, setLayerState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [layerRetry, setLayerRetry] = useState(0)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)

  useEffect(() => {
    if (step !== 'setting' || !advanced) return
    const controller = new AbortController()
    setLayerState('loading')
    void (async () => {
      try {
        const response = await fetchAllDocs<Layer>(`${surface.apiRoute.replace(/\/$/, '')}/xp-layers?depth=0`, { credentials: 'include', signal: controller.signal })
        if (!response.ok) throw new Error('groups')
        if (!controller.signal.aborted) { setLayers(response.docs); setLayerState('ready') }
      } catch { if (!controller.signal.aborted) setLayerState('error') }
    })()
    return () => controller.abort()
  }, [step, advanced, surface.apiRoute, layerRetry])

  async function submit() {
    if (inFlight.current || (kind === 'flag' && !point) || !name.trim()) return
    inFlight.current = true
    setPending(true)
    setError('')
    try {
      const { id } = await createTest(surface.apiRoute, { kind, unitType: kind === 'page' ? 'visitor' : unitType, name, ...(kind === 'flag' ? { flagPoint: point!.id } : surface.pageCollections?.length === 1 ? { pageCollection: surface.pageCollections[0]!.slug } : {}),
        ...(kind !== 'flag' || layer === undefined ? {} : { layer }), ...(hypothesis.trim() ? { hypothesis } : {}) })
      if (kind === 'page') { setCreated(id); setPending(false); return }
      router.push(formatAdminURL({ adminRoute: surface.adminRoute, path: `/experiments/${encodeURIComponent(String(id))}` }))
    } catch (cause) {
      setError(cause instanceof CreateRefused ? cause.message : C.createError)
      inFlight.current = false
      setPending(false)
    }
  }

  if (created !== undefined) return <PageWizard id={created} surface={surface} />
  const collections = [...new Set(pages?.map(page => page.collection))]
  return <div className="xp-new-test">
    {step === 'kind' ? <>
      <h2>{C.question}</h2>
      <div className="xp-new-test-cards">
        {pages !== undefined ? <button type="button" className="xp-new-test-card" onClick={() => setStep('block')}>
          <strong>{C.block}</strong><span>{C.blockMeaning}</span>{(surface.admin?.descriptions ?? surface.descriptions)?.block ? <span>{(surface.admin?.descriptions ?? surface.descriptions)?.block}</span> : null}
        </button> : null}
        {surface.pageCollections?.length ? <button type="button" className="xp-new-test-card" onClick={() => { setKind('page'); setStep('name') }}>
          <strong>{C.page}</strong><span>{C.pageMeaning}</span>{(surface.admin?.descriptions ?? surface.descriptions)?.page ? <span>{(surface.admin?.descriptions ?? surface.descriptions)?.page}</span> : null}
        </button> : null}
        {surface.flagPoints.length > 0 ? <button type="button" className="xp-new-test-card" onClick={() => { setKind('flag'); setStep('setting') }}>
          <strong>{C.setting}</strong><span>{C.settingMeaning}</span>{surface.descriptions?.setting ? <span>{surface.descriptions.setting}</span> : null}
        </button> : null}
      </div>
      {pages === undefined && !surface.flagPoints.length && !surface.pageCollections?.length ? <p>{C.unavailable}</p> : null}
    </> : step === 'block' ? <>
      <h2>{C.block}</h2><p>{C.handoff}</p>
      {!pages?.length ? <p>{C.noPages}</p> : collections.map(collection => {
        const group = pages!.filter(page => page.collection === collection)
        return <section key={collection}><h2>{group[0]!.collectionLabel}</h2><ul>
          {group.map(page => <li key={`${typeof page.id}:${page.id}`}><span>{page.title}</span>{' '}<a href={page.editorUrl}>{C.open}</a>{page.editor === 'blocks' ? <p>{C.blocksHandoff}</p> : null}</li>)}
        </ul>{group.length === 50 ? <p>{C.recentPages}</p> : null}</section>
      })}
    </> : step === 'setting' ? <>
      <h2>{C.chooseSetting}</h2>
      <fieldset><legend>{C.setting}</legend>{surface.flagPoints.map(setting => <label key={setting.id} className="xp-new-test-choice">
        <input type="radio" name="setting" checked={pointId === setting.id} onChange={() => {
          if (pointId !== setting.id) { setPointId(setting.id); setName(setting.label) }
        }} />{setting.label}{setting.description ? <span>{setting.description}</span> : null}
      </label>)}</fieldset>
      <fieldset aria-describedby="xp-new-people-help"><legend>{C.people}</legend>
        <label><input type="radio" name="people" checked={unitType === 'visitor'} onChange={() => setUnitType('visitor')} />{C.visitors}</label>
        <label><input type="radio" name="people" checked={unitType === 'user'} onChange={() => setUnitType('user')} />{C.users}</label>
      </fieldset><p id="xp-new-people-help">{C.peopleHelp}</p>
      <details open={advanced} onToggle={event => setAdvanced(event.currentTarget.open)}><summary>{C.advanced}</summary>
        <label>{C.group}<select aria-describedby="xp-new-group-help" disabled={layerState !== 'ready'}
          value={layer === undefined ? '' : layers.findIndex(item => item.id === layer)} onChange={event => setLayer(event.currentTarget.value === '' ? undefined : layers[Number(event.currentTarget.value)]?.id)}>
          <option value="">{C.noGroup}</option>{layers.map((item, index) => <option key={index} value={index}>{item.name}</option>)}
        </select></label><p id="xp-new-group-help">{C.groupHelp}</p>
        {layerState === 'loading' ? <p role="status">{C.groupsLoading}</p> : layerState === 'error' ? <p role="alert">{C.groupsError}{' '}<button type="button" onClick={() => setLayerRetry(value => value + 1)}>{C.retry}</button></p> : null}
      </details>
    </> : <form onSubmit={event => { event.preventDefault(); void submit() }}>
      <h2>{C.nameQuestion}</h2>
      <label>{C.name}<input required value={name} disabled={pending} onChange={event => setName(event.currentTarget.value)} /></label>
      <label>{C.hypothesis}<textarea value={hypothesis} disabled={pending} onChange={event => setHypothesis(event.currentTarget.value)} /></label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={pending || !name.trim()}>{pending ? C.creating : C.createTest}</button>
    </form>}
    <div className="xp-new-test-actions">
      <button type="button" disabled={pending} onClick={() => {
        if (step === 'kind') router.push(formatAdminURL({ adminRoute: surface.adminRoute, path: '/experiments' }))
        else { setError(''); setStep(step === 'name' && kind === 'flag' ? 'setting' : 'kind') }
      }}>{C.back}</button>
      {step === 'setting' ? <button type="button" disabled={!point} onClick={() => setStep('name')}>{C.next}</button> : null}
    </div>
  </div>
}
