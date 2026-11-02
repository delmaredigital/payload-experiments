'use client'
import type { KindParts, SectionProps } from '../contracts.js'
import { TEST_PAGE as C } from '../../copy/testPage.js'
import { placementLine, slotReady } from './pageBlock.model.js'

function Binding({ test }: SectionProps) {
  const placements = test.preflight?.placements ?? []
  return <div className="xp-page-binding">{placements.length ? <>
    {placements.map((placement, index) => <p key={index}>{placementLine(placement)}{' '}
      {placement.editorUrl ? <a href={placement.editorUrl}>{C.openPage}</a> : null}</p>)}<p>{C.editedOnPage}</p>
  </> : <p>{C.notPlaced}</p>}</div>
}
function VersionContent({ test, armIndex }: SectionProps & { armIndex: number }) {
  const arm = test.doc?.arms[armIndex]
  if (!arm) return null
  if (arm.kind === 'holdout') return <p>{C.holdoutContent}</p>
  const placements = test.preflight?.placements ?? []
  return <div>{placements.length ? placements.map((placement, index) => <p key={index}>
    <span>{placement.title}: </span><span className={slotReady(placement, arm) ? 'xp-content-ready' : 'xp-content-empty'}>
      {slotReady(placement, arm) ? C.ready : C.emptySlot}</span>{' '}
    {placement.editorUrl ? <a href={placement.editorUrl}>{C.editOnPage}</a> : null}</p>) : <p>{C.emptySlot}</p>}</div>
}
export const pageBlockParts: KindParts = { Binding, VersionContent }
