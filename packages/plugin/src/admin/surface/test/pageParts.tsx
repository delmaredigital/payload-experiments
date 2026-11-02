'use client'
import type { KindParts, SectionProps } from '../contracts.js'
import { TEST_PAGE as C } from '../../copy/testPage.js'
import { pageTargetIssue, setPageTarget, showsPageTarget } from '../../arms/pageTarget.model.js'
import { FieldErrors, reasonFor, save, TextEdit } from './fields.js'

function VersionContent({ test, armIndex }: SectionProps & { armIndex: number }) {
  const arm = test.doc?.arms[armIndex]
  if (!arm || !test.doc) return null
  if (!showsPageTarget(test.doc.kind, arm.kind)) return <p>{C.holdoutContent}</p>
  const issue = pageTargetIssue(arm.pageTarget, arm.kind)
  return <><TextEdit label={`${arm.label}: ${C.pageAddress}`} value={arm.pageTarget ?? ''} reason={reasonFor(test, 'arms')}
    onCommit={value => save(test, 'arms', () => ({ arms: test.doc!.arms.map(current => current.key === arm.key ? setPageTarget(current, value) : current) }))} />
    {issue ? <p role="alert">{issue}</p> : null}<FieldErrors test={test} path={`arms.${armIndex}.pageTarget`} /></>
}
export const pageParts: KindParts = { Binding: () => <p>{C.pageBinding}</p>, VersionContent }
