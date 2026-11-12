'use client'
import { useEffect, useState, type ReactNode } from 'react'
import type { DocId } from '../../../types/contracts.js'
import type { SurfaceProps, TestDocApi } from '../contracts.js'
import { useTestDocument } from '../useTestDocument.js'
import { TEST_PAGE as C } from '../../copy/testPage.js'
import { pageBlockParts } from '../pageBlock/parts.js'
import { settingParts } from '../setting/parts.js'
import { pageParts } from './pageParts.js'
import { Section } from './Section.js'
import { Hypothesis, TestName } from './fields.js'
import { VersionsSection } from './VersionsSection.js'
import { GoalSection } from './GoalSection.js'
import { TargetingSection } from './TargetingSection.js'
import { LengthSection } from './LengthSection.js'
import { AdvancedSection } from './AdvancedSection.js'
import { Button } from '../../../ui/Button.js'
import { Banner } from '../../../ui/Feedback.js'
import { Rail } from './Rail.js'
import { ReadinessBar } from './ReadinessBar.js'
import { ResultsBody } from '../results/ResultsBody.js'
import type { TestDocument } from '../testDocument.model.js'
import type { PreflightResult } from '../../../types/endpoints.js'
import './testPage.css'

export function TestSurface({ id, surface, onTitleChange, renderFrame, embedded = false, onDocument, onPreflight }: {
  id: DocId; surface: SurfaceProps; onTitleChange?: (title: string) => void; embedded?: boolean
  renderFrame?: (content: { test: TestDocApi; children: ReactNode }) => ReactNode
  onDocument?: (doc: TestDocument) => void; onPreflight?: (preflight: PreflightResult) => void
}) {
  const [barHeight, setBarHeight] = useState<number>()
  const test = useTestDocument(id, { apiRoute: surface.apiRoute, refetchPreflightOnFocus: true, ...(!surface.canManage ? { enabled: false } : {}), ...(onDocument ? { onDocument } : {}), ...(onPreflight ? { onPreflight } : {}) })
  useEffect(() => { if (test.doc?.name) onTitleChange?.(test.doc.name) }, [test.doc?.name, onTitleChange])
  const frame = (body: ReactNode) => {
    const children = <div className="xp-test-surface">{body}</div>
    return renderFrame ? renderFrame({ test, children }) : children
  }
  // Results readers have no permission to load the manager-only test/preflight.
  if (!surface.canManage) return frame(<ResultsBody id={id} surface={surface} />)
  if (test.loadState !== 'ready' || !test.doc) return frame(<div className="xp-test-page" role={test.loadState === 'error' ? 'alert' : 'status'}>
    <p>{test.loadState === 'forbidden' ? C.forbidden : test.loadState === 'missing' ? C.missing : test.loadState === 'error' ? C.error : C.loading}</p>
    {test.loadState === 'error' ? <Button onClick={() => void test.reload()}>{C.retry}</Button> : null}
  </div>)
  const parts = test.doc.kind === 'block' ? pageBlockParts : test.doc.kind === 'page' ? pageParts : settingParts
  const props = { test, surface }
  return frame(
    <div className="xp-test-page xp-test-page--setup" style={{ paddingBottom: embedded || barHeight === undefined ? undefined : `${barHeight}px` }}>
    <div className="xp-test-layout"><Rail test={test} /><div className="xp-test-content">
    {test.errors._section ? <Banner tone="error" action={test.stale ? <Button onClick={() => void test.reload()}>{C.reload}</Button> : undefined}>{test.errors._section}</Banner> : null}
    <Section test={test} sectionId="what">
      <TestName {...props} /><parts.Binding {...props} /><Hypothesis {...props} />
    </Section>
    <VersionsSection {...props} parts={parts} contentOnCanvas={embedded} /><GoalSection {...props} /><TargetingSection {...props} />
    <LengthSection {...props} /><AdvancedSection {...props} />
    {embedded && surface.canReadResults && test.doc.status !== 'draft' ? <ResultsBody key={`${test.doc.id}/${test.doc.updatedAt}/${test.doc.status}`} id={id} surface={surface} onChanged={doc => { test.acceptTransition?.({ doc }); void test.reload() }} /> : null}
    </div></div>
    <ReadinessBar {...props} onHeightChange={setBarHeight} />
  </div>)
}
