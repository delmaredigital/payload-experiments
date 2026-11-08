'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation.js'
import { formatAdminURL } from 'payload/shared'
import type { DocId } from '../../../types/contracts.js'
import type { SurfaceProps } from '../contracts.js'
import { useTestDocument } from '../useTestDocument.js'
import { CopyRoute } from '../pagePicker/CopyRoute.js'
import { PageCombobox } from '../pagePicker/PageCombobox.js'
import { testPageCollection, controlFirst } from '../pagePicker/pagePicker.model.js'
import { NEW_TEST_COPY as C } from '../../copy/newTest.js'
import { READINESS_COPY } from '../../copy/readiness.js'
import { TEST_PAGE } from '../../copy/testPage.js'
import { SURFACE_COPY } from '../../copy/surface.js'
import { pageStepCopy } from '../../copy/pages.js'
import { READINESS, nextStep, pageReadinessContext, readinessArm } from '../readiness/readiness.model.js'
import { FieldErrors } from '../test/fields.js'
import { SaveStatus } from '../readiness/SaveStatus.js'
import { createApi } from '../../api.js'
import { useTransition } from '../readiness/useTransition.js'

/** One session stays mounted across Collection, all page steps and Review. */
export function PageWizard({ id, surface }: { id: DocId; surface: SurfaceProps }) {
  const router = useRouter()
  const collections = surface.pageCollections ?? []
  const [step, setStep] = useState(collections.length > 1 ? 'collection' : 'control')
  const test = useTestDocument(id, { apiRoute: surface.apiRoute, refetchPreflightOnFocus: step === 'review' })
  const testUrl = formatAdminURL({ adminRoute: surface.adminRoute, path: `/experiments/${encodeURIComponent(String(id))}` })
  const transition = useTransition(test, () => router.push(testUrl))
  useEffect(() => { if (step === 'review') void test.refreshPreflight() }, [step, test.refreshPreflight])
  const leave = () => router.push(testUrl)
  if (test.loadState === 'loading') return <p role="status">{TEST_PAGE.loading}</p>
  if (!test.doc || test.loadState !== 'ready') return <div><p role="alert">{test.loadState === 'forbidden' ? TEST_PAGE.forbidden : test.loadState === 'missing' ? TEST_PAGE.missing : TEST_PAGE.error}</p><button type="button" onClick={() => void test.reload()}>{TEST_PAGE.retry}</button><button type="button" onClick={leave}>{C.backToTest}</button></div>
  const doc = test.doc
  const collection = testPageCollection(collections, doc, test.preflight?.pagePlacements)
  const arms = controlFirst(doc.arms).filter(arm => arm.kind !== 'holdout')
  const steps = [...(collections.length > 1 ? ['collection'] : []), ...arms.map(arm => arm.key), 'review']
  const arm = arms.find(item => item.key === step)
  const ctx = pageReadinessContext(doc, test.preflight, surface)
  const next = nextStep(test.preflight, ctx)
  const ready = Boolean(test.preflight && !test.preflightPending && !test.preflightError && test.preflight.checks.every(check => check.ok))
  const busy = test.hasUnsaved || test.saving === 'saving' || transition.busy
  const jump = (section: string, key?: string) => {
    if (section === 'versions') setStep(key ?? arms.find(item => !item.pageTarget)?.key ?? 'control')
    else router.push(`${testUrl}#section-${section}`)
  }
  const picker = arm && collection ? <PageCombobox key={`${collection.slug}/${arm.key}`} collection={collection} test={test} armKey={arm.key} apiRoute={surface.apiRoute} /> : null
  return <div className="xp-new-test xp-page-wizard">
    <h2>{step === 'collection' ? C.collection : step === 'review' ? C.review : arm?.kind === 'control' ? C.original : pageStepCopy(arm?.label ?? '')}</h2>
    <SaveStatus test={test} />
    {test.errors._section ? <p role="alert">{test.errors._section}</p> : null}
    {step === 'collection' ? <fieldset><legend>{C.collection}</legend>{collections.map(entry => <label key={entry.slug}>
      <input type="radio" name="page-collection" checked={doc.pageCollection === entry.slug} disabled={busy} onChange={() => {
        test.stage({ pageCollection: entry.slug }); void test.commit()
      }} />{entry.label}
    </label>)}</fieldset> : step === 'review' ? <>
      {test.preflightError ? <p role="alert">{test.preflightError}</p> : null}
      <ul>{test.preflight?.checks.map((check, index) => {
        if (!Object.hasOwn(READINESS, check.code)) return check.ok ? null : <li key={`${check.code}/${index}`}>{SURFACE_COPY.next}</li>
        const row = READINESS[check.code]
        const sentence = row.next(check.detail, ctx)
        const label = typeof row.nextStep === 'function' ? row.nextStep(check.detail, ctx) : row.nextStep
        return sentence && !check.ok ? <li key={`${check.code}/${index}`}>{sentence}{label ? <button type="button" onClick={() => jump(row.section, readinessArm(check.code, check.detail, ctx))}>{label}</button> : null}</li> : null
      })}</ul>
      {ready ? <p>{READINESS_COPY.ready}</p> : null}
      <button type="button" disabled={busy || test.preflightPending || !test.preflight} onClick={() => {
        if (ready) void transition.run(() => createApi(surface.apiRoute).start(id))
        else if (next) jump(next.section, next.arm)
      }}>{ready ? C.start : C.finishSetup}</button>
      {transition.error ? <p role="alert">{transition.error}</p> : null}
    </> : arm?.kind === 'control' ? <><p>{C.originalHelp}</p>{picker}</> : collection ? <CopyRoute collection={collection}>{picker}</CopyRoute> : null}
    {arm ? <FieldErrors test={test} path={`arms.${doc.arms.findIndex(item => item.key === arm.key)}.pageTarget`} /> : null}
    <div className="xp-new-test-actions">
      <button type="button" disabled={busy} onClick={() => {
        const previous = steps[steps.indexOf(step) - 1]
        if (previous) setStep(previous); else leave()
      }}>{C.back}</button>
      <button type="button" disabled={busy} onClick={leave}>{C.backToTest}</button>
      {step !== 'review' ? <button type="button" disabled={busy || (step === 'collection' && !collection)} onClick={() => setStep(steps[steps.indexOf(step) + 1] ?? 'review')}>{C.next}</button> : null}
    </div>
    {test.errors.pageCollection ? <p role="alert">{test.errors.pageCollection}</p> : null}
  </div>
}
