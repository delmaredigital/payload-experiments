'use client'
import { surfaceUrls } from '../../surfaceUrls.js'
import { useEffect, useState } from 'react'
import { formatAdminURL } from 'payload/shared'
import type { DocId } from '../../../types/contracts.js'
import type { SurfaceProps } from '../contracts.js'
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
import { SurfaceShell } from '../SurfaceShell.js'
import { Button } from '../../../ui/Button.js'
import { Banner, StatusChip } from '../../../ui/Feedback.js'
import { Rail } from './Rail.js'
import { ReadinessBar } from './ReadinessBar.js'
import './testPage.css'

export function TestPage({ id, surface, onTitleChange }: { id: DocId; surface: SurfaceProps; onTitleChange?: (title: string) => void }) {
  const [barHeight, setBarHeight] = useState<number>()
  const test = useTestDocument(id, { apiRoute: surface.apiRoute, refetchPreflightOnFocus: true })
  useEffect(() => { if (test.doc?.name) onTitleChange?.(test.doc.name) }, [test.doc?.name, onTitleChange])
  if (test.loadState !== 'ready' || !test.doc) return <SurfaceShell adminRoute={surface.adminRoute} title={C.test} crumbs={[{ label: C.tests, href: surfaceUrls.home(surface.adminRoute) }, { label: C.test }]}><div className="xp-test-page" role={test.loadState === 'error' ? 'alert' : 'status'}>
    <p>{test.loadState === 'forbidden' ? C.forbidden : test.loadState === 'missing' ? C.missing : test.loadState === 'error' ? C.error : C.loading}</p>
    {test.loadState === 'error' ? <Button onClick={() => void test.reload()}>{C.retry}</Button> : null}
  </div></SurfaceShell>
  const parts = test.doc.kind === 'block' ? pageBlockParts : test.doc.kind === 'page' ? pageParts : settingParts
  const props = { test, surface }
  return <SurfaceShell adminRoute={surface.adminRoute} title={test.doc.name}
    crumbs={[{ label: C.tests, href: surfaceUrls.home(surface.adminRoute) }, { label: test.doc.name }]}
    status={<><span className="xp-tests-kind">{C.kinds[test.doc.kind]}</span><StatusChip status={test.doc.status} /></>}
    actions={surface.canReadResults && ['running', 'stopped', 'decided'].includes(test.doc.status)
      ? <Button variant="secondary" href={formatAdminURL({ adminRoute: surface.adminRoute, path: `/experiments/${encodeURIComponent(String(test.doc.id))}/results` })}>{C.results}</Button> : undefined}>
    <div className="xp-test-page xp-test-page--setup" style={{ paddingBottom: barHeight === undefined ? undefined : `${barHeight}px` }}>
    <div className="xp-test-layout"><Rail test={test} /><div className="xp-test-content">
    {test.errors._section ? <Banner tone="error" action={test.stale ? <Button onClick={() => void test.reload()}>{C.reload}</Button> : undefined}>{test.errors._section}</Banner> : null}
    <Section test={test} sectionId="what">
      <TestName {...props} /><parts.Binding {...props} /><Hypothesis {...props} />
    </Section>
    <VersionsSection {...props} parts={parts} /><GoalSection {...props} /><TargetingSection {...props} />
    <LengthSection {...props} /><AdvancedSection {...props} />
    </div></div>
    <ReadinessBar {...props} onHeightChange={setBarHeight} />
  </div></SurfaceShell>
}
