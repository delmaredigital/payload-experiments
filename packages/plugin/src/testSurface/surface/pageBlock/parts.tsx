'use client'
import type { KindParts, SectionProps } from '../contracts.js'
import { Button } from '../../../ui/Button.js'
import { placementPages } from '../../../lib/placementPages.js'
import { TEST_PAGE as C, placementCount } from '../../copy/testPage.js'
import { placementLine, slotReady } from './pageBlock.model.js'

function Binding({ test, surface }: SectionProps) {
  const placements = test.preflight?.placements ?? []
  return <div className="xp-page-binding">{surface.editorPlacementMessage ? test.doc?.status === 'running' ? <p role="status">{surface.editorPlacementMessage}</p> : null : placements.length ? <>
    {placementPages(placements).map(placement => <p className="xp-ui-button-group" key={placement.key}>{placementLine(placement)}{placement.slotCount > 1 ? placementCount(placement.slotCount) : null}{' '}
      {placement.editorUrl ? <Button variant="link" size="sm" href={placement.editorUrl}>{C.openPage}</Button> : null}</p>)}<p>{C.editedOnPage}</p>
  </> : test.preflight?.checks.some(check => !check.ok && check.code === 'no-placements') ? null : <p>{C.notPlaced}</p>}</div>
}
function VersionContent({ test, armIndex, summary }: SectionProps & { armIndex: number; summary?: boolean }) {
  const arm = test.doc?.arms[armIndex]
  if (!arm) return null
  if (arm.kind === 'holdout') return <span className="xp-content-chip">{C.holdoutContent}</span>
  const placements = test.preflight?.placements ?? []
  const pages = placementPages(placements)
  const ready = placements.length > 0 && placements.every(placement => slotReady(placement, arm))
  return <div className="xp-version-content"><span className={`xp-content-chip ${ready ? 'xp-content-ready' : 'xp-content-empty'}`}>{ready ? C.ready : C.empty}</span>
    <div className="xp-ui-button-group">{!summary ? pages.filter(page => page.editorUrl).map(page => <Button key={page.key} variant="link" size="sm" href={page.editorUrl!}
      aria-label={pages.length > 1 ? `${C.editOnPage}: ${page.title}` : undefined}>{C.editOnPage}</Button>) : null}</div></div>
}
export const pageBlockParts: KindParts = { Binding, VersionContent }
