'use client'
import type { KindParts, SectionProps } from '../contracts.js'
import { TEST_PAGE as C } from '../../copy/testPage.js'
import { pageTargetIssue, setPageTarget, showsPageTarget } from '../../arms/pageTarget.model.js'
import { normalisePath } from '../../../runtime/normalisePath.js'
import { CopyRoute } from '../pagePicker/CopyRoute.js'
import { PageCombobox } from '../pagePicker/PageCombobox.js'
import { testPageCollection } from '../pagePicker/pagePicker.model.js'
import { PAGE_COPY as P } from '../../copy/pages.js'
import { FieldErrors, reasonFor, save, TextEdit } from './fields.js'

export function VersionContent({ test, surface, armIndex }: SectionProps & { armIndex: number }) {
  const arm = test.doc?.arms[armIndex]
  if (!arm || !test.doc) return null
  if (!showsPageTarget(test.doc.kind, arm.kind)) return <span className="xp-content-chip">{C.holdoutContent}</span>
  const collection = testPageCollection(surface.pageCollections, test.doc, test.preflight?.pagePlacements)
  const placement = test.preflight?.pagePlacements?.find(entry => entry.arm === arm.key && entry.collection === collection?.slug && entry.id != null && arm.pageTarget && normalisePath(entry.path) === normalisePath(arm.pageTarget))
  if (collection) {
    const picker = <PageCombobox collection={collection} test={test} armKey={arm.key} apiRoute={surface.apiRoute} />
    return <div className="xp-version-content xp-version-content--page">
      <strong>{P.where}</strong>
      {placement?.id != null ? <div>{placement.editorUrl ? <a href={placement.editorUrl} target="_blank" rel="noopener">{P.open}</a> : null}{' '}{placement.url ? <a href={placement.url} target="_blank" rel="noopener">{P.preview}</a> : null}</div> : null}
      {arm.kind === 'variant' ? <CopyRoute collection={collection} /> : null}
      {picker}
      <FieldErrors test={test} path={`arms.${armIndex}.pageTarget`} />
    </div>
  }
  const issue = pageTargetIssue(arm.pageTarget, arm.kind)
  return <div className="xp-version-content"><span className={`xp-content-chip ${issue ? 'xp-content-empty' : 'xp-content-ready'}`}>{issue ? C.addPageAddress : C.pageReady}</span><TextEdit label={`${arm.label}: ${C.pageAddress}`} value={arm.pageTarget ?? ''} reason={reasonFor(test, 'arms')}
    onCommit={value => save(test, 'arms', () => ({ arms: test.doc!.arms.map(current => current.key === arm.key ? setPageTarget(current, value) : current) }))} />
    {issue ? <p role="alert">{issue}</p> : null}<FieldErrors test={test} path={`arms.${armIndex}.pageTarget`} /></div>
}
export const pageParts: KindParts = { Binding: () => <p>{C.pageBinding}</p>, VersionContent }
